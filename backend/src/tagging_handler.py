"""ML Lambda entry point — S3 upload processing and query-by-file inference.

Deployment note
---------------
This file lives in backend/src/ so it shares repository, storage, catalog,
and notifier with the API Lambda, but it is the entry point of the *ML
container Lambda* (ecolens-prod-media-processor), not the API Lambda.

  API Lambda  (ZIP)      → entry point: backend.src.main.handler (FastAPI)
  ML Lambda   (Container)→ entry point: backend.src.tagging_handler.lambda_handler

The ML container (ml-service/Dockerfile) copies backend/src alongside
ml_pipeline/ so this handler can import from both.  The API Lambda also
bundles this file, but never invokes it — it is dead code there.

ml_pipeline imports (process_image, process_video) are intentionally lazy
(inside _run_ml_file) so this module can be imported in the API Lambda ZIP
without crashing, even though torch/opencv are not installed there.
"""

from __future__ import annotations

import io
import json
import tempfile
import traceback
from pathlib import Path
from typing import Callable
from urllib.parse import unquote_plus

from PIL import Image

from . import notifier, repository, storage
from .aws import s3
from .config import settings


def _upload_detections_json(bucket: str, key: str, detections: list) -> None:
    """Upload pretty-printed detection JSON to S3."""
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(detections, indent=2).encode("utf-8"),
        ContentType="application/json",
    )


def _parse_key(key: str) -> tuple[str, str]:
    """Get file_id and extension out of uploads/<file_id>.<ext>"""
    filename = key.split("/")[-1]
    file_id = filename.split(".")[0]
    ext = Path(filename).suffix
    return file_id, ext


def _get_uploader(bucket: str, key: str) -> str:
    """Read the uploader's user_id from S3 object metadata (x-amz-meta-user-id)."""
    resp = s3.head_object(Bucket=bucket, Key=key)
    user_id = resp.get("Metadata", {}).get("user-id", "unknown")
    return user_id


def _top_confidence(detections: list[dict]) -> float:
    """Highest classification confidence across all detections (0 if none)."""
    confs = [d.get("classification_confidence", 0.0) for d in detections]
    return max(confs, default=0.0)


def _run_ml_file(local_path: Path) -> dict:
    # Use the ml_pipeline directly — this handler runs inside the ML container
    # Lambda where torch, opencv, and megadetector are all available.
    # process_image / process_video run batched inference (single MegaDetector
    # pass over all crops/frames) which is much faster than the frame-by-frame
    # approach in media_analysis.detect_tags_from_path.
    suffix = local_path.suffix.lower()
    if suffix in {".mp4", ".mov", ".avi", ".mkv"}:
        from ml_pipeline.video_processor import process_video
        result = process_video(local_path)
    else:
        from ml_pipeline.pipeline import process_image
        result = process_image(local_path)
    return {
        "file_type": result["file_type"],
        "tags": result.get("tags", {}),
        "detections": result.get("detections", []),
    }


def _pil_to_thumbnail_bytes(img: Image.Image) -> bytes:
    """Resize a PIL image to fit within 300x300 and return JPEG bytes."""
    img.thumbnail((300, 300), Image.Resampling.LANCZOS)

    # Convert RGBA/indexed images to RGB for JPEG compatibility
    if img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "RGBA":
            bg.paste(img, mask=img.split()[-1])
        else:
            bg.paste(img)
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=85, optimize=True)
    return buffer.getvalue()


def _create_thumbnail(local_path: Path, file_id: str) -> str | None:
    """
    Create and upload a thumbnail.
    - Images: open with PIL directly.
    - Videos: extract the first frame with OpenCV and use that as the thumbnail,
      reusing the same frame already decoded during ML inference instead of
      re-reading the whole video.
    Returns the S3 key where the thumbnail was written, or None on error.
    """
    try:
        suffix = local_path.suffix.lower()
        if suffix in {".mp4", ".mov", ".avi", ".mkv"}:
            # Extract first frame via OpenCV — the frame is already decoded
            # during ML inference so this is essentially free (codec is warm).
            import cv2
            cap = cv2.VideoCapture(str(local_path))
            ok, frame = cap.read()
            cap.release()
            if not ok:
                print(f"Thumbnail: could not read first frame from {file_id}")
                return None
            # OpenCV gives BGR; convert to RGB for PIL
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(frame_rgb)
        else:
            img = Image.open(local_path)

        thumbnail_bytes = _pil_to_thumbnail_bytes(img)

        thumb_key = storage.thumbnail_key(file_id)
        s3.put_object(
            Bucket=settings.s3_thumbnail_bucket,
            Key=thumb_key,
            Body=thumbnail_bytes,
            ContentType="image/jpeg",
        )
        return thumb_key
    except Exception as e:
        print(f"Thumbnail generation failed for {file_id}: {e}")
        return None


def process_s3_object(bucket: str, key: str, run_ml: Callable[[Path], dict]) -> dict:
    """
    Tag one uploaded object and save its record. `run_ml` is the ML
    pipeline's process_file - injected so this is testable on its own.
    """
    file_id, ext = _parse_key(key)
    user_id = _get_uploader(bucket, key)

    # Download to Lambda's /tmp, then run detection on it.
    local_path = Path(tempfile.gettempdir()) / f"{file_id}{ext}"
    s3.download_file(bucket, key, str(local_path))
    result = run_ml(local_path)  # {"file_type", "tags": {species: count}, "detections": [...]}

    file_type = result["file_type"]
    tags = result["tags"]
    detections = result.get("detections", [])

    # Store the rich detection data in S3 (keeps the DB row small).
    det_key = storage.detections_key(file_id)
    # Use the shared helper to upload pretty-printed detections JSON
    _upload_detections_json(settings.s3_detections_bucket, det_key, detections)

    # Generate thumbnail for both images and videos.
    # Images: resized from the original. Videos: first frame extracted via OpenCV.
    thumb_key = _create_thumbnail(local_path, file_id)

    # Conditional write -> if this file_id is already saved, it's a no-op (dedup).
    created = repository.put_file_record(
        file_id=file_id,
        user_id=user_id,
        file_type=file_type,
        original_key=key,                 # the uploaded key IS the original
        thumbnail_key=thumb_key,
        detections_key=det_key,
        tags=tags,
        animal_detected=bool(tags),
        top_confidence=_top_confidence(detections),
        status="processed",
    )

    # Only notify for genuinely new files (not duplicate re-uploads).
    if created:
        notifier.publish_new_file(list(tags), thumbnail_key=thumb_key)
    return {"file_id": file_id, "file_type": file_type, "tags": tags}


def _handle_query_invocation(event: dict) -> dict:
    """
    Direct invocation path: called by the API Lambda for query-by-file requests.

    The event contains:
      { "query_s3_key": "<key>", "query_s3_bucket": "<bucket>" }

    Synchronous (image) path — returns tags directly:
      Returns: { "tags": { "koala": 2, ... } }

    Async (video) path — writes result to S3 and returns immediately:
      event also contains "result_s3_key": "results/<job_id>.json"
      Writes { "tags": {...} } or { "tags": {}, "error": "..." } to that key,
      then returns {}. The API Lambda polls for this file via GET /media/similar/result.

    In both paths the temp file on S3 is always deleted in the finally block.
    """
    bucket = event["query_s3_bucket"]
    key = event["query_s3_key"]
    result_key = event.get("result_s3_key")   # present only for async (video) path
    ext = Path(key).suffix or ".jpg"
    local_path = Path(tempfile.gettempdir()) / f"query-{Path(key).stem}{ext}"

    result_payload: dict = {"tags": {}}
    try:
        print(f"[tagging_handler] Query invocation: s3://{bucket}/{key}"
              f"{' (async)' if result_key else ' (sync)'}")
        s3.download_file(bucket, key, str(local_path))
        ml_result = _run_ml_file(local_path)
        tags = ml_result.get("tags", {})
        print(f"[tagging_handler] Query result tags: {tags}")
        result_payload = {"tags": tags}
    except Exception as exc:
        print(f"[tagging_handler] Query invocation error: {exc}")
        traceback.print_exc()
        result_payload = {"tags": {}, "error": str(exc)}
    finally:
        # Always delete the temp file from S3 — the local file is also cleaned up.
        local_path.unlink(missing_ok=True)
        try:
            s3.delete_object(Bucket=bucket, Key=key)
            print(f"[tagging_handler] Deleted temp file s3://{bucket}/{key}")
        except Exception as del_exc:
            print(f"[tagging_handler] Could not delete temp file: {del_exc}")

    if result_key:
        # Async path: write result JSON to S3 so the API Lambda can poll for it.
        try:
            s3.put_object(
                Bucket=bucket,
                Key=result_key,
                Body=json.dumps(result_payload).encode("utf-8"),
                ContentType="application/json",
            )
            print(f"[tagging_handler] Wrote result to s3://{bucket}/{result_key}")
        except Exception as write_exc:
            print(f"[tagging_handler] Could not write result JSON: {write_exc}")
        return {}   # async caller ignores return value

    # Sync path: return tags directly to the waiting API Lambda.
    return result_payload


def lambda_handler(event, context):
    """
    AWS Lambda entry point.

    Handles two event types:
    1. S3 ObjectCreated trigger (Records key present):
       Download → ML inference → thumbnails → DB write → SNS notify
    2. Direct query invocation (query_s3_key key present):
       Download → ML inference → return tags (no DB write, no SNS)
    """
    # Direct invocation from API Lambda for query-by-file
    if "query_s3_key" in event:
        return _handle_query_invocation(event)

    # S3 event trigger (normal upload processing)
    results = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])
        try:
            result = process_s3_object(bucket, key, _run_ml_file)
            results.append(result)
        except Exception as exc:
            # Log the full traceback so CloudWatch captures it.
            print(f"[tagging_handler] ERROR processing s3://{bucket}/{key}: {exc}")
            traceback.print_exc()

            # Best-effort: write a failed status record so the file is
            # visible in the DB and won't silently vanish.
            try:
                file_id, _ = _parse_key(key)
                user_id = _get_uploader(bucket, key)
                repository.put_file_record(
                    file_id=file_id,
                    user_id=user_id,
                    file_type="unknown",
                    original_key=key,
                    tags={},
                    animal_detected=False,
                    top_confidence=0.0,
                    status="failed",
                )
            except Exception as inner_exc:
                print(f"[tagging_handler] Could not write failed record: {inner_exc}")

            results.append({"file_id": key, "status": "failed", "error": str(exc)})

    return {"statusCode": 200, "results": results}
