"""
API schemas - Pydantic models for request/response bodies.

FastAPI uses these to validate input at the edge: a bad request is
rejected with a clear 422 before our handler code ever runs.
"""

from __future__ import annotations

from pydantic import BaseModel


# Upload 

class PresignRequest(BaseModel):
    """What browser sends to ask for an upload URL"""
    filename: str          # original name, used to read the extension
    checksum: str          # sha256 of the file, computed in browser
    content_type: str = "application/octet-stream"


class PresignResponse(BaseModel):
    """Reply: either duplicate, or here's where to upload"""
    duplicate: bool                        # True = we already have this file
    file_url: str                          # canonical URL of the file either way
    upload_url: str | None = None          # presigned PUT URL (None when duplicate)
    upload_headers: dict[str, str] = {}    # headers the client must send with the PUT


# Queries 

class SpeciesQuery(BaseModel):
    """Find files containing every listed species (count >= 1 each)"""
    species: list[str]


class MediaResultItem(BaseModel):
    """Single search result item — thumbnail URL, original URL, tags, and media type."""
    url: str               # thumbnail URL for images; full URL for videos
    original_url: str      # full-size original file URL (same as url for videos)
    file_type: str         # "image" or "video"
    tags: dict[str, int]   # detected species → count, e.g. {"koala": 3, "dingo": 1}


class QueryResult(BaseModel):
    """List of matching result items with thumbnail URLs and media types."""
    urls: list[str]             # kept for backwards compatibility
    count: int
    items: list[MediaResultItem]  # preferred — use this for rendering


class ThumbnailQuery(BaseModel):
    """Map a thumbnail URL back to its full-size image"""
    thumbnail_url: str


class FullImageResponse(BaseModel):
    """The full-size image URL behind a thumbnail"""
    file_url: str
    tags: dict[str, int] = {}


# Data management

class BulkTagEdit(BaseModel):
    """Add or remove tags across many files at once"""
    urls: list[str]        # files to modify (any URL we produced)
    tags: list[str]        # tag names to add/remove
    operation: int         # 1 = add, 0 = remove


class DeleteRequest(BaseModel):
    """Delete files (originals + thumbnails + DB records)"""
    urls: list[str]


class SubscribeRequest(BaseModel):
    """Subscribe to email alerts when files with these species appear"""
    species: list[str]
    email: str | None = None   # defaults to the signed-in user's email
