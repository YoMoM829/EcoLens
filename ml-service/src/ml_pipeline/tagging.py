"""Utility to tag in-memory image bytes using the ML pipeline."""

from __future__ import annotations

from pathlib import Path
import tempfile
from typing import List

from .pipeline import process_file


def tag_image_bytes(image_bytes: bytes) -> List[str]:
    """Write image bytes to a temp file, run the ML pipeline, and return labels list."""
    if not image_bytes:
        return []

    fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
    try:
        with open(fd, "wb") as f:
            f.write(image_bytes)
        result = process_file(tmp_path)
    finally:
        try:
            Path(tmp_path).unlink()
        except Exception:
            pass

    tags = result.get("tags", {}) if isinstance(result, dict) else {}
    labels: List[str] = []
    for species, count in (tags or {}).items():
        labels.extend([species] * int(count))
    return labels
