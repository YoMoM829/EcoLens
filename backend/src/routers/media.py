"""
Media router — the core resource of the EcoLens RESTful API.

All operations act on the shared media pool (files uploaded by any user).

  GET    /media?tag=koala:2&tag=wombat:1  → search by tag counts  (AND, min count)
  GET    /media?species=koala&species=dingo→ search by species     (AND, count >= 1)
  GET    /media/{file_id}                 → resolve file_id → full-size URL
  POST   /media/similar/presign           → get a presigned S3 PUT URL for a query file
  POST   /media/similar                   → find similar by reference file (via S3 key)
  POST   /media/tags                      → bulk add / remove tags across many files
  DELETE /media                           → delete files, thumbnails, and DB records

Query-by-file uses a two-step flow to avoid API Gateway's 6 MB body limit:
  1. POST /media/similar/presign  { filename, content_type }
     → { upload_url, s3_key }
  2. Browser PUTs file bytes directly to upload_url (S3 presigned URL — no size limit)
  3. POST /media/similar  multipart: s3_key=<key>
     → API Lambda invokes ML Lambda with the S3 key, waits for tags,
        queries DB, deletes the temp file, and returns matching media items.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import boto3
import botocore.exceptions
from fastapi import APIRouter, Body, Form, HTTPException, Query

from ..auth import CurrentUser
from ..aws import s3
from ..config import settings
from ..schemas import BulkTagEdit, DeleteRequest, FullImageResponse, MediaResultItem, QueryResult
from .. import notifier, repository, search, storage

router = APIRouter()

# Presigned PUT URL validity for query-by-file temp uploads (5 minutes).
# Temp files go to s3_query_temp_bucket — a dedicated bucket with no S3 event
# trigger and a 1-day lifecycle rule. They are also deleted immediately after
# ML inference completes.
_QUERY_TEMP_EXPIRY = 300

# Boto3 Lambda client — reused across warm invocations
_lambda_client = boto3.client("lambda", region_name=settings.aws_region)


# ── Search ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=QueryResult)
def get_media(
    tag: list[str] = Query(
        default=[],
        description=(
            "Tag-count filter. Repeat for multiple species. "
            "Format: `species:minCount`, e.g. `tag=koala:2&tag=wombat:1`. "
            "All conditions are ANDed."
        ),
    ),
    species: list[str] = Query(
        default=[],
        description=(
            "Species filter (count >= 1 each). Repeat for multiple. "
            "e.g. `species=koala&species=dingo`. All must be present (AND)."
        ),
    ),
    user: CurrentUser = None,  # noqa: ARG001 – enforces authentication
):
    """
    Search the shared media pool.

    Supply **either** `tag` params (with explicit minimum counts) **or**
    `species` params (minimum count of 1 implied).  Both can be combined;
    conflicting keys are resolved by taking the higher minimum count.

    Returns thumbnail URLs for images and full-size URLs for videos.
    """
    if not tag and not species:
        raise HTTPException(400, "Provide at least one 'tag' or 'species' query parameter")

    required: dict[str, int] = {}

    # species params: reuse the same AND filter with a minimum count of 1 for each species
    for s in species:
        s = s.strip()
        if s:
            required[s] = max(required.get(s, 0), 1)

    # tag params: format "species:minCount"
    for t in tag:
        t = t.strip()
        if not t:
            continue
        if ":" not in t:
            raise HTTPException(
                400,
                f"Invalid tag filter '{t}' — expected format 'species:minCount', e.g. 'koala:2'",
            )
        species_name, _, count_str = t.partition(":")
        try:
            count = int(count_str)
        except ValueError:
            raise HTTPException(400, f"Invalid count in tag filter '{t}' — must be an integer")
        if count < 1:
            raise HTTPException(400, f"Minimum count in tag filter '{t}' must be >= 1")
        required[species_name.strip()] = max(required.get(species_name.strip(), 0), count)

    records = repository.scan_all_records()
    items = search.find_matching(records, required)
    return QueryResult(urls=[i.url for i in items], count=len(items), items=items)


@router.get("/similar/result/{job_id}", response_model=QueryResult)
def poll_similar_result(
    job_id: str,
    user: CurrentUser = None,  # noqa: ARG001 — enforces authentication
):
    """
    Poll for the result of an async video query started by POST /media/similar.

    Returns:
      202  { status: "processing" }  — ML Lambda is still running
      200  QueryResult               — done; result JSON deleted from S3
      502  { detail: "..." }         — ML Lambda reported an error
    """
    if not settings.s3_query_temp_bucket:
        raise HTTPException(500, "S3_QUERY_TEMP_BUCKET is not configured")

    rk = _result_key(job_id)

    # Try to read the result JSON written by the ML Lambda.
    try:
        obj = s3.get_object(Bucket=settings.s3_query_temp_bucket, Key=rk)
        result = json.loads(obj["Body"].read())
    except botocore.exceptions.ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in ("NoSuchKey", "404"):
            # Not ready yet — still processing.
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=202, content={"status": "processing"})
        raise HTTPException(502, f"Could not read result: {exc}") from exc
    finally:
        # Always delete the result JSON once read (or on any other error).
        # If the read succeeded we're cleaning up; if it 404'd this is a no-op.
        try:
            s3.delete_object(Bucket=settings.s3_query_temp_bucket, Key=rk)
        except Exception:
            pass

    # ML Lambda reported an error.
    if result.get("error"):
        raise HTTPException(502, f"Video analysis failed: {result['error']}")

    tags: dict = result.get("tags", {})
    if not tags:
        return QueryResult(urls=[], count=0, items=[])

    required = {species: 1 for species in tags}
    records = repository.scan_all_records()
    items = search.find_matching(records, required)
    return QueryResult(urls=[i.url for i in items], count=len(items), items=items)


@router.get("/{file_id}", response_model=FullImageResponse)
def get_media_by_id(file_id: str, user: CurrentUser = None):  # noqa: ARG001
    """
    Return the full-size URL for the media file identified by `file_id`.

    The file_id is the SHA-256 of the original file and is embedded in every
    URL returned by the system (thumbnail and original alike).  Clients can
    extract it by taking the filename segment from any URL and dropping the
    extension — e.g. `https://.../thumbnails/abc123.jpg` → `abc123`.
    """
    record = repository.get_file_record(file_id)
    if not record:
        raise HTTPException(404, f"No media found for file_id '{file_id}'")
    return FullImageResponse(
        file_url=storage.original_url(record["original_key"]),
        tags=record.get("tags") or {},
    )


# ── Find similar ──────────────────────────────────────────────────────────────

@router.post("/similar/presign")
def presign_query_upload(
    filename: str = Form(...),
    content_type: str = Form(...),
    user: CurrentUser = None,  # noqa: ARG001 — enforces authentication
):
    """
    Step 1 of the two-step query-by-file flow.

    Returns a short-lived presigned S3 PUT URL the browser can use to upload
    a reference file directly to S3 — bypassing API Gateway's 6 MB body limit.
    The returned s3_key must be passed to POST /media/similar as the next step.

    The file is stored in the dedicated query-temp S3 bucket and deleted after
    ML inference. It is never added to the database.
    """
    if not settings.s3_query_temp_bucket:
        raise HTTPException(500, "S3_QUERY_TEMP_BUCKET is not configured")
    ext = Path(filename).suffix.lower()
    s3_key = f"{uuid.uuid4()}{ext}"
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_query_temp_bucket,
            "Key": s3_key,
            "ContentType": content_type,
        },
        ExpiresIn=_QUERY_TEMP_EXPIRY,
    )
    return {"upload_url": upload_url, "s3_key": s3_key}


_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def _is_video_key(s3_key: str) -> bool:
    return Path(s3_key).suffix.lower() in _VIDEO_EXTENSIONS


def _result_key(job_id: str) -> str:
    """S3 key for the async result JSON file in the query-temp bucket."""
    return f"results/{job_id}.json"


@router.post("/similar", response_model=QueryResult, status_code=200)
def find_similar(
    s3_key: str = Form(...),
    user: CurrentUser = None,  # noqa: ARG001 — enforces authentication
):
    """
    Step 2 of the two-step query-by-file flow.

    Images — synchronous path (unchanged):
      Invokes the ML Lambda with RequestResponse, waits for tags, queries DB,
      deletes the temp file, returns matching items immediately.

    Videos — asynchronous path (bypasses API Gateway's 29-second timeout):
      Fires the ML Lambda with Event (async, returns in <1 s), returns HTTP 202
      { job_id, status: "processing" }.  The ML Lambda processes the video in
      the background and writes a result JSON to the query-temp bucket.
      The caller must then poll GET /media/similar/result/{job_id} for the result.
      The ML Lambda always deletes the temp video file itself (in its finally block).

    In both paths the temp file is never stored in the database.
    """
    if not settings.ml_lambda_name:
        raise HTTPException(500, "ML_LAMBDA_NAME is not configured")
    if not settings.s3_query_temp_bucket:
        raise HTTPException(500, "S3_QUERY_TEMP_BUCKET is not configured")

    # ── Video: async path ──────────────────────────────────────────────────────
    if _is_video_key(s3_key):
        job_id = Path(s3_key).stem          # UUID stem, no extension
        rk = _result_key(job_id)
        try:
            _lambda_client.invoke(
                FunctionName=settings.ml_lambda_name,
                InvocationType="Event",     # fire-and-forget — returns immediately
                Payload=json.dumps({
                    "query_s3_key": s3_key,
                    "query_s3_bucket": settings.s3_query_temp_bucket,
                    "result_s3_key": rk,    # ML Lambda writes result here when done
                }).encode(),
            )
        except Exception as exc:
            # Async invoke failed before ML Lambda even started — clean up now.
            try:
                s3.delete_object(Bucket=settings.s3_query_temp_bucket, Key=s3_key)
            except Exception:
                pass
            raise HTTPException(502, f"Could not start video analysis: {exc}") from exc

        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"job_id": job_id, "status": "processing"},
        )

    # ── Image: synchronous path (unchanged behaviour) ──────────────────────────
    try:
        response = _lambda_client.invoke(
            FunctionName=settings.ml_lambda_name,
            InvocationType="RequestResponse",
            Payload=json.dumps({
                "query_s3_key": s3_key,
                "query_s3_bucket": settings.s3_query_temp_bucket,
            }).encode(),
        )
        payload = json.loads(response["Payload"].read())
    except Exception as exc:
        raise HTTPException(502, f"ML Lambda invocation failed: {exc}") from exc
    finally:
        # Image temp file: always deleted here in the API Lambda.
        # (For videos the ML Lambda deletes it in its own finally block.)
        try:
            s3.delete_object(Bucket=settings.s3_query_temp_bucket, Key=s3_key)
        except Exception:
            pass

    if response.get("FunctionError"):
        raise HTTPException(502, f"ML Lambda error: {payload}")

    tags: dict = payload.get("tags", {})
    if not tags:
        return QueryResult(urls=[], count=0, items=[])

    required = {species: 1 for species in tags}
    records = repository.scan_all_records()
    items = search.find_matching(records, required)
    return QueryResult(urls=[i.url for i in items], count=len(items), items=items)


# ── Tag management ────────────────────────────────────────────────────────────

@router.post("/tags")
def patch_tags(body: BulkTagEdit, user: CurrentUser = None):  # noqa: ARG001
    """
    Bulk add or remove tags across multiple media files.

    `operation = 1` (add): each listed tag is added with count 1 if not
    already present; existing counts are preserved.
    `operation = 0` (remove): each listed tag is dropped; tags absent from
    a file are silently ignored.

    Any authenticated user may edit tags on any file (shared-access platform).
    """
    updated: list[str] = []
    not_found: list[str] = []

    for url in body.urls:
        # The file_id is baked into the URL, so look the record up directly
        file_id = storage.file_id_from_url(url)
        record = repository.get_file_record(file_id)
        if not record:
            not_found.append(url)
            continue

        existing_tags = dict(record.get("tags", {}))
        tags = dict(existing_tags)
        if body.operation == 1:                  # add
            for t in body.tags:
                tags.setdefault(t, 1)            # keep existing count if already present
        else:                                     # remove
            for t in body.tags:
                tags.pop(t, None)                # ignore tags that aren't on the file

        repository.update_tags(file_id, tags)
        updated.append(url)

        # Notify subscribers for any species that are genuinely new to this file
        if body.operation == 1:
            newly_added = [t for t in body.tags if t not in existing_tags]
            if newly_added:
                notifier.publish_new_file(newly_added, thumbnail_key=record.get("thumbnail_key"))

    return {"updated": len(updated), "not_found": not_found}


# ── Deletion ──────────────────────────────────────────────────────────────────

@router.delete("/")
def delete_media(
    body: DeleteRequest = Body(...),
    user: CurrentUser = None,
):
    """
    Delete media files, their thumbnails, detection JSON, and DB records.

    Pass a JSON body `{ "urls": ["https://...", ...] }`.
    Only the user who uploaded a file may delete it.
    Returns counts and URL lists for deleted, not-found, and forbidden files.
    """
    caller = user["sub"]
    deleted: list[str] = []
    not_found: list[str] = []
    forbidden: list[str] = []

    for url in body.urls:
        file_id = storage.file_id_from_url(url)
        record = repository.get_file_record(file_id)
        if not record:
            not_found.append(url)
            continue

        if record.get("user_id") != caller:
            forbidden.append(url)
            continue

        s3.delete_object(Bucket=settings.s3_upload_bucket, Key=record["original_key"])
        if record.get("detections_key"):
            s3.delete_object(Bucket=settings.s3_detections_bucket, Key=record["detections_key"])
        if record.get("thumbnail_key"):
            s3.delete_object(Bucket=settings.s3_thumbnail_bucket, Key=record["thumbnail_key"])

        repository.delete_file_record(file_id)
        deleted.append(url)

    return {"deleted": len(deleted), "not_found": not_found, "forbidden": forbidden}
