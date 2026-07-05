"""Repository layer for persisting and retrieving tagged file metadata."""

from __future__ import annotations

from datetime import datetime, timezone
from . import catalog, storage


def _record_to_catalog_item(record: dict) -> dict:
    original_key = record.get("original_key")
    thumbnail_key = record.get("thumbnail_key")
    # Plain (non-presigned) URLs stored per requirement: save file/thumbnail URLs to DB.
    source_url = storage.plain_original_url(original_key) if original_key else None
    thumbnail_url = storage.plain_thumbnail_url(thumbnail_key) if thumbnail_key else None
    return {
        "media_id": record["file_id"],       # OCI NoSQL primary key column
        "user_id": record.get("user_id"),
        "file_type": record.get("file_type", "image"),
        "status": record.get("status", "processed"),
        "source_url": source_url,
        "thumbnail_url": thumbnail_url,
        "original_key": original_key,
        "thumbnail_key": thumbnail_key,
        "detections_key": record.get("detections_key"),
        "tags": record.get("tags", {}),
        "animal_detected": record.get("animal_detected", False),
        "top_confidence": record.get("top_confidence", 0.0),
        "created_at": record.get("created_at"),
    }


def _catalog_item_to_record(item: dict) -> dict:
    return {
        # Fall back to media_id for records written before this cleanup
        "file_id": item.get("file_id") or item.get("media_id"),
        "user_id": item.get("user_id"),
        # Fall back to media_type for records written before this cleanup
        "file_type": item.get("file_type") or item.get("media_type", "image"),
        "original_key": item.get("original_key"),
        "thumbnail_key": item.get("thumbnail_key"),
        "detections_key": item.get("detections_key"),
        "status": item.get("status", "processed"),
        "tags": item.get("tags", {}),
        "animal_detected": item.get("animal_detected", False),
        "top_confidence": item.get("top_confidence", 0.0),
        "created_at": item.get("created_at"),
    }


def put_file_record(
    *,
    file_id: str,
    user_id: str,
    file_type: str,
    original_key: str,
    thumbnail_key: str | None = None,
    detections_key: str | None = None,
    tags: dict[str, int],
    animal_detected: bool = False,
    top_confidence: float = 0.0,
    status: str = "processed",
) -> bool:
    created_at = datetime.now(timezone.utc).isoformat()
    record = {
        "file_id": file_id,
        "user_id": user_id,
        "file_type": file_type,
        "original_key": original_key,
        "status": status,
        "tags": tags,
        "animal_detected": animal_detected,
        "top_confidence": float(top_confidence),
        "created_at": created_at,
        "thumbnail_key": thumbnail_key,
        "detections_key": detections_key,
        # Presigned URLs are NOT stored — only S3 keys are persisted.
        # URLs are generated fresh on demand when serving query results.
    }
    # Atomic dedup: add_item only inserts if this file_id is new, and returns
    # False if it already existed (so we don't overwrite a duplicate).
    return catalog.add_item(_record_to_catalog_item(record))


def get_file_record(file_id: str) -> dict | None:
    """Retrieve a saved file record by its file_id/checksum."""
    if not file_id:
        return None
    found = catalog.find_by_id(file_id)
    if found is None:
        return None
    return _catalog_item_to_record(found)


def scan_all_records() -> list[dict]:
    """Return all persisted file records from the catalog."""
    return [_catalog_item_to_record(item) for item in catalog.load_all()]


def update_tags(file_id: str, tags: dict[str, int]) -> None:
    """Update the tag map for an existing file record."""
    existing = catalog.find_by_id(file_id)
    if existing is None:
        return
    catalog.update_item(file_id, {"tags": tags})


def delete_file_record(file_id: str) -> None:
    """Delete a file record by its file_id (primary key)."""
    catalog.delete_by_id(file_id)
