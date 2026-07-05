"""Shared helpers for assembling inference results."""

from __future__ import annotations

from collections import Counter
from typing import Any

from . import config


def aggregate_classifications(
    crops: list[dict[str, Any]],
    classifications: list[dict[str, Any]],
    *,
    frame: str | None = None,
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    """Merge crop metadata with classifier output into tags and detection records."""
    tag_counts: Counter[str] = Counter()
    enriched: list[dict[str, Any]] = []

    for crop, classification in zip(crops, classifications):
        species = classification["species"]
        confidence = classification["confidence"]

        if confidence < config.CLASSIFICATION_CONF_THRESHOLD:
            continue

        tag_counts[species] += 1
        detection = {
            "species": species,
            "classification_confidence": confidence,
            "detection_confidence": crop["detection_confidence"],
            "bbox": crop["bbox"],
            "top_predictions": classification["top_predictions"],
        }
        if frame is not None:
            detection["frame"] = frame
        enriched.append(detection)

    return dict(tag_counts), enriched


def build_inference_result(
    *,
    source: str,
    file_type: str,
    tags: dict[str, int],
    detections: list[dict[str, Any]],
    frames_processed: int | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "file": source,
        "file_type": file_type,
        "tags": tags,
        "detections": detections,
    }
    if frames_processed is not None:
        result["frames_processed"] = frames_processed
    return result
