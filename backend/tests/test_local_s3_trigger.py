#!/usr/bin/env python3
"""Simulate an S3 upload event and run the tagging handler locally.

Placed under `backend/tests/` because it exercises backend tagging and storage.
"""
from pathlib import Path
import shutil
import tempfile
import json
import sys
from pathlib import Path as _Path

# Ensure repo root is on sys.path so `backend` and `ml-service` packages import correctly
# file is in backend/tests/, so parents[2] is the repo root
REPO_ROOT = str(_Path(__file__).resolve().parents[2])
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from backend.src import tagging_handler, repository
from backend.src import aws as backend_aws

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover - dev dependency
    raise SystemExit("Pillow is required for the test script: pip install Pillow")


def _make_test_image(path: Path):
    img = Image.new("RGB", (640, 480), (255, 128, 0))
    img.save(path, format="JPEG")


def main():
    tmp_dir = Path(tempfile.gettempdir())
    source_img = tmp_dir / "ecolens_test_image.jpg"
    _make_test_image(source_img)

    # Patch S3 client's download_file to copy from our test image
    def fake_download_file(bucket, key, filename, ExtraArgs=None, Callback=None, Config=None):
        shutil.copy(source_img, filename)

    # Patch put_object to write thumbnail/detections bytes locally for inspection
    def fake_put_object(Bucket, Key, Body, ContentType=None):
        out = tmp_dir / Key.replace("/", "_")
        if hasattr(Body, "read"):
            data = Body.read()
        else:
            data = Body
        out.write_bytes(data)
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def fake_head_object(Bucket, Key):
        return {"Metadata": {"user-id": "testuser"}}

    def fake_upload_file(src, bucket, key, ExtraArgs=None):
        shutil.copy(src, tmp_dir / key.replace("/", "_"))
        return None

    # All S3 calls go through the shared singleton in aws.py — patch once
    backend_aws.s3.download_file = fake_download_file
    backend_aws.s3.put_object = fake_put_object
    backend_aws.s3.head_object = fake_head_object
    backend_aws.s3.upload_file = fake_upload_file

    # Dummy ML function to avoid importing heavy ML stack
    def dummy_run_ml(local_path: Path):
        return {"file_type": "image", "tags": {"koala": 1}, "detections": []}

    # Flat key format: uploads/<file_id>.<ext> — user_id is in S3 object metadata
    bucket = "unused"
    key = "uploads/abc123.jpg"

    print("Running tagging flow (simulated)...")
    result = tagging_handler.process_s3_object(bucket, key, dummy_run_ml)
    print("Result:", json.dumps(result, indent=2))

    rec = repository.get_file_record("abc123")
    print("Saved record:", json.dumps(rec, indent=2))


if __name__ == "__main__":
    main()
