"""Local media analysis helpers that bridge frontend uploads to the ML pipeline."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}


def count_labels(labels: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for label in labels:
        counts[label] = counts.get(label, 0) + 1
    return counts


def detect_tags_from_image_bytes(image_bytes: bytes) -> list[str]:
    return tag_image_bytes(image_bytes)


def tag_image_bytes(image_bytes: bytes) -> List[str]:
    """Tag image bytes using the ML package when available."""
    if not image_bytes:
        return []

    try:
        from ml_pipeline import tag_image_bytes as ml_tag_image_bytes

        return ml_tag_image_bytes(image_bytes)
    except Exception:
        pass

    try:
        from ml_pipeline import process_file as process_file
    except Exception:
        raise ImportError(
            "ML tagging library not found; install or include `ml-service/src/ml_pipeline` in the package"
        )
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


def detect_tags_from_path(path: Path) -> dict[str, int]:
    suffix = path.suffix.lower()

    if suffix in IMAGE_EXTENSIONS:
        labels = detect_tags_from_image_bytes(path.read_bytes())
        return count_labels(labels)

    if suffix in VIDEO_EXTENSIONS:
        # Frame interval is driven by VIDEO_FRAME_RATE from ml_pipeline config
        # (default 1.0 fps, matching requirement §4.2.2).  Import lazily so
        # the backend works even when ml_pipeline is not yet on sys.path.
        try:
            from ml_pipeline.config import VIDEO_FRAME_RATE
        except Exception:
            VIDEO_FRAME_RATE = 1.0
        frame_interval = 1.0 / max(VIDEO_FRAME_RATE, 0.01)  # seconds between samples

        import cv2
        cap = cv2.VideoCapture(str(path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 1
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = total_frames / (fps or 1)
        # Per teaching team clarification: tag count = maximum count of that
        # species seen in any single frame (not cumulative sum across frames).
        # e.g. frame1: Sus_scrofa=4, frame2: Sus_scrofa=1 → Sus_scrofa=4
        max_counts: dict[str, int] = {}
        pos = 0.0
        while pos <= duration:
            cap.set(cv2.CAP_PROP_POS_MSEC, pos * 1000)
            ok, frame = cap.read()
            if not ok:
                pos += frame_interval
                continue
            encoded, buf = cv2.imencode(".jpg", frame)
            if encoded:
                labels = detect_tags_from_image_bytes(buf.tobytes())
                # Count occurrences of each species in this single frame
                frame_counts: dict[str, int] = {}
                for label in labels:
                    frame_counts[label] = frame_counts.get(label, 0) + 1
                # Update the running maximum per species
                for species, count in frame_counts.items():
                    if count > max_counts.get(species, 0):
                        max_counts[species] = count
            pos += frame_interval
        cap.release()
        return max_counts

    raise ValueError(f"Unsupported file type: {suffix}")