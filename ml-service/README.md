# Aussie EcoLens ML pipeline

This folder contains the **species detection and classification library** used by Aussie EcoLens. It runs MegaDetector plus a species classifier on local image/video files and produces **catalog metadata records** in the same shape the backend persists to Oracle NoSQL / local JSON.

S3 event handling, thumbnail uploads, detections JSON uploads, database writes, and SNS notifications live in **`../backend/src/tagging_handler.py`**, which imports inference from this package via `../backend/src/media_analysis.py`.

## Responsibilities

This package **does**:

1. Detect animals in images (MegaDetector).
2. Crop detections and classify species.
3. Extract video frames and aggregate species counts.
4. Build metadata records aligned with `backend/src/repository.py`.
5. Expose entry points for the backend and local testing.

This package **does not**:

- Handle S3 `ObjectCreated` events (see `backend/src/tagging_handler.py`).
- Write metadata to Oracle NoSQL or local JSON (see `backend/src/repository.py` and `backend/src/catalog.py`).
- Upload thumbnails or detections JSON to S3 (see `backend/src/tagging_handler.py`).
- Issue presigned URLs or serve HTTP APIs (see `backend/`).

## Layout

```text
ml-service/
├── handler.py              # Local import shim (adds src/ to PYTHONPATH)
├── src/
│   └── ml_pipeline/
│       ├── __init__.py       # Exports process_file, build_metadata_record, ...
│       ├── classes.py        # Supported species label mapping
│       ├── classifier.py     # Species classification inference
│       ├── config.py         # Model paths and inference thresholds (env-driven)
│       ├── cropper.py        # Detection crop helpers
│       ├── detector.py       # MegaDetector wrapper
│       ├── metadata.py       # Catalog record builder (matches backend schema)
│       ├── model_loader.py   # Lazy Torch model loading
│       ├── pipeline.py       # Inference + metadata assembly
│       ├── tagging.py        # tag_image_bytes helper
│       └── video_processor.py
├── models/                   # Local model weights (not committed; see below)
│   ├── mdv5a.pt
│   └── model.pt
├── tests/
│   └── test_local.py         # CLI harness; saves metadata JSON locally
├── requirements.txt
├── Dockerfile                # Optional container image for bundling ML dependencies
└── .env.example
```

## Metadata output (backend-compatible)

`process_file()` returns a metadata record that matches what `backend/src/repository.put_file_record()` expects:

```json
{
  "file_id": "a1b2c3d4e5f6...",
  "user_id": "cognito-sub-or-local-user",
  "file_type": "image",
  "original_key": "uploads/<sha256>.jpg",
  "thumbnail_key": "thumbnails/<sha256>.jpg",
  "detections_key": "detections/<sha256>.json",
  "status": "processed",
  "tags": {"Vombatus_ursinus": 2, "Macropus_giganteus": 1},
  "animal_detected": true,
  "top_confidence": 0.92,
  "created_at": "2026-06-05T02:00:00Z"
}
```

Notes on the schema:

- **`file_id`** — SHA-256 checksum of the file (same value the browser sends at upload time). Used as the primary key for dedup.
- **`file_type`** — `"image"` or `"video"` (required by the rubric).
- **`tags`** — species → count map (logical AND queries in the backend rely on counts, not a flat list).
- **`thumbnail_key`** — set for images; `null` for videos.
- **`detections_key`** — S3 key where raw detection JSON is stored in production. The metadata record itself does not embed the full detections array.
- **`created_at`** — UTC timestamp (`Z` suffix). Example: `13:38Z` = 11:38pm in AEST (UTC+10).

S3 key layout mirrors `backend/src/storage.py` (`uploads/`, `thumbnails/`, `detections/`).

Lower-level helpers `process_image()` and `process_video()` still return internal inference results (`tags` + raw `detections`). Only `process_file()` assembles the catalog record.

## Backend integration

In production the flow is:

```text
S3 upload
  → backend/tagging_handler.py
      → media_analysis.py (calls ml_pipeline)
      → uploads detections JSON to S3 at detections_key
      → uploads thumbnail (images only)
      → repository.put_file_record(...)  // persists the metadata fields above
  → backend query/delete/tag APIs read the same record shape
```

`process_file(path, user_id=..., file_id=...)` is designed so its return value maps directly onto `put_file_record()`:

| `process_file` field | `put_file_record` parameter |
|----------------------|----------------------------|
| `file_id` | `file_id` |
| `user_id` | `user_id` |
| `file_type` | `file_type` |
| `original_key` | `original_key` |
| `thumbnail_key` | `thumbnail_key` |
| `detections_key` | `detections_key` |
| `tags` | `tags` |
| `animal_detected` | `animal_detected` |
| `top_confidence` | `top_confidence` |
| `status` | `status` |

The backend still orchestrates S3 I/O and persistence today via `tagging_handler.py`. When wiring the backend to call `process_file()` directly, pass the Cognito `sub` as `user_id` and the upload checksum as `file_id` so keys line up with presigned upload paths.

Packaging requirement: include `ml-service/src` on `PYTHONPATH` (or copy `ml_pipeline` into the Lambda bundle) so `media_analysis.py` can import the library.

## Model files

Place pre-trained weights under `models/` before running locally or building the Docker image:

- `models/mdv5a.pt` — MegaDetector weights
- `models/model.pt` — species classifier weights

Override paths with `MEGADETECTOR_PATH` and `SPECIES_MODEL_PATH`.

## Configuration

Inference behaviour is controlled via environment variables in `src/ml_pipeline/config.py`:

| Variable | Purpose | Default |
|----------|---------|---------|
| `MEGADETECTOR_PATH` | MegaDetector weights file | `models/mdv5a.pt` |
| `SPECIES_MODEL_PATH` | Species classifier weights | `models/model.pt` |
| `CLASSIFICATION_CONF_THRESHOLD` | Minimum confidence to accept a species tag | `0.8` |
| `VIDEO_FRAME_RATE` | Target frames sampled per second from video | `1.0` |
| `MAX_VIDEO_FRAMES` | Cap sampled frames per video (`0` = no cap) | `0` |
| `DETECTOR_BATCH_SIZE` | MegaDetector GPU/CPU batch size | `8` |
| `CLASSIFIER_BATCH_SIZE` | Species classifier batch size | `32` |
| `LOWER_CONF` | MegaDetector score threshold | `0.05` |
| `SNIP_SIZE` | Detection crop size | `600` |

## Performance

The pipeline is optimised for video and multi-crop images:

- **In-memory crops** — detected regions are classified without writing crop JPEGs to disk.
- **Batched MegaDetector** — all sampled video frames are scored in one `detect_animals_batch()` call (temp frame JPEGs only live for the duration of the batch).
- **Batched classifier** — crop tensors are forwarded in chunks of `CLASSIFIER_BATCH_SIZE`.
- **Smarter frame sampling** — skipped frames use `cap.grab()` instead of full decode/read.

Tune `VIDEO_FRAME_RATE`, `MAX_VIDEO_FRAMES`, and batch sizes to balance speed vs accuracy. On CPU-only Lambda, lowering frame rate usually helps more than raising batch sizes.

## Local testing

### 1. Install dependencies

```bash
cd ml-service
python -m pip install -r requirements.txt
```

### 2. Run inference and save metadata JSON

Writes `<input_stem>.json` beside the input file (catalog record shape):

```bash
python tests/test_local.py path/to/image.jpg
python tests/test_local.py path/to/video.mp4 --user-id testuser
python tests/test_local.py path/to/video.mp4 -o results/out.json
```

### 3. Import from Python

```bash
cd ml-service
set PYTHONPATH=src
python -c "from ml_pipeline import process_file; import json; print(json.dumps(process_file('path/to/image.jpg', user_id='testuser'), indent=2))"
```

### 4. Test the full upload pipeline (S3 → tags → metadata)

Use the backend harness, which exercises `tagging_handler` end to end:

```bash
cd ..
python backend/tests/test_local_s3_trigger.py
```

## Docker image (optional)

The `Dockerfile` builds a Lambda-compatible image containing `ml_pipeline` and model weights. It is **not** the production S3 handler; use it only if you want a container base for heavy ML dependencies.

```bash
cd ml-service
# Ensure models/mdv5a.pt and models/model.pt exist first
docker build -t ecolens-ml .
```

Production deployment is described in `../infra/README.md` and `../backend/README.md`.

## Notes

- Keep this folder focused on **inference and metadata assembly**; do not add HTTP or S3 orchestration here.
- Update models by replacing weight files and/or updating `MEGADETECTOR_PATH` / `SPECIES_MODEL_PATH`.
- Tag output uses scientific species names from `classes.py` (for example `Vombatus_ursinus`).
