"""
Storage layer (S3 keys + URLs).

We store S3 *keys* in the database, then build a full URL only when we
need to hand one back. file_id (the sha256 checksum) is the filename, so
every key/URL carries it and any URL can be mapped straight back to its record.
"""

from __future__ import annotations

from .config import settings
from .aws import s3

# How long presigned GET URLs stay valid. 1 hour covers typical browser
# sessions; the frontend will get a fresh URL on the next search anyway.
PRESIGN_EXPIRY = 3600


# --- S3 key layout (this is what we store in the DB) -------------------------

def upload_key(file_id: str, ext: str) -> str:
    """Original upload, e.g. uploads/<file_id>.jpg — user_id is in S3 metadata."""
    ext = ext.lstrip(".").lower()
    return f"uploads/{file_id}.{ext}"


def thumbnail_key(file_id: str) -> str:
    """Image thumbnail, e.g. thumbnails/<file_id>.jpg"""
    return f"thumbnails/{file_id}.jpg"


def detections_key(file_id: str) -> str:
    """Raw detection JSON, e.g. detections/<file_id>.json"""
    return f"detections/{file_id}.json"


# --- Plain (unsigned) S3 URLs -------------------------------------------------
# Stored in OCI NoSQL to satisfy the requirement of persisting file/thumbnail URLs.
# Buckets are private so these 403 in a browser — presigned URLs are generated
# at query time for actual client access.

def plain_url(bucket: str, key: str) -> str:
    return f"https://{bucket}.s3.{settings.aws_region}.amazonaws.com/{key}"


def plain_original_url(key: str) -> str:
    return plain_url(settings.s3_upload_bucket, key)


def plain_thumbnail_url(key: str) -> str:
    return plain_url(settings.s3_thumbnail_bucket, key)


# --- Presigned GET URLs -------------------------------------------------------
# All S3 buckets are private (public access blocked). The browser cannot load
# images via plain S3 URLs — it gets a 403. Presigned URLs embed temporary
# credentials in the query string so the browser can fetch directly from S3
# without any public bucket policy.

def presigned_url(bucket: str, key: str, expires: int = PRESIGN_EXPIRY) -> str:
    """Return a presigned S3 GET URL valid for `expires` seconds."""
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


def original_url(key: str) -> str:
    """Presigned GET URL for an original-upload key."""
    return presigned_url(settings.s3_upload_bucket, key)


def thumbnail_url(key: str) -> str:
    """Presigned GET URL for a thumbnail key."""
    return presigned_url(settings.s3_thumbnail_bucket, key)


def file_id_from_url(url: str) -> str:
    """
    Pull the file_id (sha256) back out of any URL we produced.
    Filename is "<file_id>.<ext>", so take the last path segment and drop
    the extension. Works with both plain S3 URLs and presigned URLs because
    the sha256 is in the path before the query string.
    """
    # Strip query string first, then take the last path segment
    path = url.split("?")[0].rstrip("/")
    filename = path.split("/")[-1]
    return filename.split(".")[0]
