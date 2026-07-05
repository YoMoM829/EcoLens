"""
Uploads router — RESTful resource for initiating a media upload.

  POST /uploads   → check for duplicates and obtain a presigned S3 PUT URL

Flow:
  1. Browser computes the file's SHA-256 and POSTs here with filename + checksum.
  2. If the checksum already exists the backend returns { duplicate: true } with
     the existing URL — no re-upload needed.
  3. Otherwise a short-lived presigned S3 PUT URL is returned.  The browser
     uploads directly to S3 and the ObjectCreated event triggers the tagging Lambda.

Dedup is enforced at three layers: this DB check, the identical S3 key
(same checksum → same key), and the conditional write when the record
is saved later.
"""

from pathlib import Path

import botocore.exceptions
from fastapi import APIRouter, HTTPException

from ..auth import CurrentUser
from ..aws import s3
from ..config import settings
from ..schemas import PresignRequest, PresignResponse
from .. import repository, storage

router = APIRouter()

# Only allow the media types the ML pipeline can actually process.
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp",
                      ".mp4", ".mov", ".avi", ".mkv"}

# How long the presigned PUT URL remains valid (seconds).
PRESIGN_EXPIRY = 3600


@router.post("/", response_model=PresignResponse)
def create_upload(req: PresignRequest, user: CurrentUser):
    """
    Initiate a media upload.

    Returns a presigned S3 PUT URL for a new file, or `{ duplicate: true }`
    with the existing URL if the checksum is already in the database.
    The caller must PUT the raw file bytes to `upload_url` directly;
    no Authorization header is needed for that S3 request.
    """
    owner = user["sub"]
    ext = Path(req.filename).suffix.lower()

    # Reject file types that we cannot tag
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    # The S3 key is derived from checksum only (no user prefix) so the same file
    # uploaded by different users maps to the same key — cross-user dedup.
    key = storage.upload_key(req.checksum, ext)
    url = storage.original_url(key)

    # Dedup check layer 1: DB record exists (ML has finished processing).
    if repository.get_file_record(req.checksum):
        return PresignResponse(duplicate=True, file_url=url)

    # Dedup check layer 2: S3 object already exists (uploaded but ML still processing).
    # This closes the race window between the S3 PUT and the DB write.
    try:
        s3.head_object(Bucket=settings.s3_upload_bucket, Key=key)
        return PresignResponse(duplicate=True, file_url=url)
    except botocore.exceptions.ClientError as exc:
        if exc.response["Error"]["Code"] not in ("404", "NoSuchKey"):
            raise

    # Embed the uploader's user_id as S3 object metadata so the tagging Lambda
    # can read it via head_object — the key no longer encodes the user.
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_upload_bucket,
            "Key": key,
            "ContentType": req.content_type,
            "Metadata": {"user-id": owner},
        },
        ExpiresIn=PRESIGN_EXPIRY,
    )
    # The client MUST send x-amz-meta-user-id with the PUT or S3 will reject
    # the request with a SignatureDoesNotMatch error (metadata is part of the signature).
    upload_headers = {"x-amz-meta-user-id": owner}
    return PresignResponse(duplicate=False, file_url=url, upload_url=upload_url, upload_headers=upload_headers)
