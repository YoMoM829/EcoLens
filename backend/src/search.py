"""
Search logic (the matching rules behind the query endpoints).

The routers pull records from the repository and pass them in

The key rule is logical AND with minimum counts: 
If file containes every req species with a count >= the requested minimum, then match
"""

from __future__ import annotations

from . import storage
from .schemas import MediaResultItem


def tags_of(record: dict) -> dict[str, int]:
    """
    Read a record's {species: count} map as plain ints.
    Values may come back as non-int numeric types, so normalise here.
    """
    return {species: int(count) for species, count in record.get("tags", {}).items()}


def matches(file_tags: dict[str, int], required: dict[str, int]) -> bool:
    """
    Logical AND: file must contain each required species with a count
    >= the requested minimum. Missing species count as 0.
    """
    return all(file_tags.get(species, 0) >= minimum
               for species, minimum in required.items())


def result_item(record: dict) -> MediaResultItem:
    """
    Build a MediaResultItem for a matched record.

    Per §4.3.1: queries return thumbnail URLs for images and full-size URLs
    for videos.  Videos also have a first-frame thumbnail, but the requirement
    explicitly asks for the full video URL so the client can stream it.
    Images return the thumbnail URL to save bandwidth; the frontend can call
    GET /media/{file_id} to resolve the full-size original (§4.3.2).

    file_type is passed through so the frontend knows whether to render an
    <img> or a <video> element without guessing from the URL extension.
    """
    file_type = record.get("file_type", "image")
    orig = storage.original_url(record["original_key"])
    if file_type == "video":
        # Requirement: return the full video URL for videos
        url = orig
    elif record.get("thumbnail_key"):
        # Images: return the thumbnail URL for bandwidth-efficient previews
        url = storage.thumbnail_url(record["thumbnail_key"])
    else:
        # Fallback: no thumbnail generated (e.g. processing failed)
        url = orig
    return MediaResultItem(
        url=url,
        original_url=orig,
        file_type=file_type,
        tags={k: int(v) for k, v in record.get("tags", {}).items()},
    )


def find_matching(records: list[dict], required: dict[str, int]) -> list[MediaResultItem]:
    """Return MediaResultItems for every record that matches `required`."""
    return [result_item(r) for r in records if matches(tags_of(r), required)]
