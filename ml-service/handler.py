"""Local import shim for the ml_pipeline package.

Adds ml-service/src to sys.path so `from handler import process_file` works
when running commands from the ml-service directory. Production S3 orchestration
lives in backend/src/tagging_handler.py, which imports ml_pipeline via
backend/src/media_analysis.py when ml-service/src is on PYTHONPATH.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from ml_pipeline import process_file, process_image, process_video, tag_image_bytes

__all__ = ["process_file", "process_image", "process_video", "tag_image_bytes"]
