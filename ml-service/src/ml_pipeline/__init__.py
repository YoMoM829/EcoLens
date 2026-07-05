"""Machine learning pipeline exports for EcoLens.

This package exposes the high-level entry points used by the backend
and any local test harness.
"""

from .metadata import build_metadata_record
from .pipeline import process_file, process_image
from .video_processor import process_video
from .tagging import tag_image_bytes

__all__ = [
    "build_metadata_record",
    "process_file",
    "process_image",
    "process_video",
    "tag_image_bytes",
]
