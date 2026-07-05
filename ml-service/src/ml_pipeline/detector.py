"""Animal detection integration using the MegaDetector model."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from megadetector.detection import run_detector_batch

from . import config
from .model_loader import load_megadetector_model_path


def _parse_image_detections(image_result: dict[str, Any]) -> list[dict[str, Any]]:
    animal_detections = []

    for detection in image_result.get("detections", []):
        if detection.get("category") != config.ANIMAL_CATEGORY_ID:
            continue

        if float(detection.get("conf", 0.0)) < config.LOWER_CONF:
            continue

        animal_detections.append(
            {
                "bbox": detection["bbox"],
                "detection_confidence": float(detection["conf"]),
                "category": detection.get("category"),
            }
        )

    return animal_detections


def detect_animals_batch(image_paths: list[str | Path]) -> list[list[dict[str, Any]]]:
    """Run MegaDetector on multiple images in one batch."""
    paths = [str(path) for path in image_paths]
    if not paths:
        return []

    batch_size = min(config.DETECTOR_BATCH_SIZE, len(paths))
    data = run_detector_batch.load_and_run_detector_batch(
        image_file_names=paths,
        model_file=load_megadetector_model_path(),
        quiet=True,
        batch_size=batch_size,
    )

    if config.SAVE_DETECTION_JSON:
        with open(config.DETECTION_JSON_PATH, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)

    if not data:
        return [[] for _ in paths]

    return [_parse_image_detections(item) for item in data]


def detect_animals(image_path: str | Path) -> list[dict[str, Any]]:
    """Run MegaDetector on a single image."""
    results = detect_animals_batch([image_path])
    return results[0] if results else []
