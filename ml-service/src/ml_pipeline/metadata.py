"""Build catalog metadata records matching the backend repository schema."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    """Compute the SHA-256 checksum used as file_id across the platform."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def upload_key(file_id: str, ext: str) -> str:
    ext = ext.lstrip(".").lower()
    return f"uploads/{file_id}.{ext}"


def thumbnail_key(file_id: str) -> str:
    return f"thumbnails/{file_id}.jpg"


def detections_key(file_id: str) -> str:
    return f"detections/{file_id}.json"


def top_confidence(detections: list[dict]) -> float:
    confidences = [float(item.get("classification_confidence", 0.0)) for item in detections]
    return max(confidences, default=0.0)


def utc_timestamp() -> str:
    """Return the current UTC time as ISO-8601 with a Z suffix (seconds precision)."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_metadata_record(
    *,
    file_id: str,
    user_id: str,
    file_path: Path,
    file_type: str,
    tags: dict[str, int],
    detections: list[dict],
    status: str = "processed",
) -> dict[str, Any]:
    """Return a metadata record aligned with backend/src/repository.py."""
    ext = file_path.suffix.lstrip(".").lower()
    return {
        "file_id": file_id,
        "user_id": user_id,
        "file_type": file_type,
        "original_key": upload_key(file_id, ext),
        "thumbnail_key": thumbnail_key(file_id) if file_type == "image" else None,
        "detections_key": detections_key(file_id),
        "status": status,
        "tags": tags,
        "animal_detected": bool(tags),
        "top_confidence": top_confidence(detections),
        "created_at": utc_timestamp(),
    }
