"""Crop detected animal regions from input images for classification."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image

from . import config


def crop_animals_from_pil(
    image: Image.Image,
    detections: list[dict[str, Any]],
    *,
    stem: str = "frame",
) -> list[dict[str, Any]]:
    """Crop detections from an in-memory image without writing files."""
    img = image.convert("RGB")
    width, height = img.size
    crops: list[dict[str, Any]] = []

    for index, detection in enumerate(detections):
        x, y, w, h = detection["bbox"]

        left = max(0, min(int(x * width), width))
        top = max(0, min(int(y * height), height))
        right = max(0, min(int((x + w) * width), width))
        bottom = max(0, min(int((y + h) * height), height))

        if right <= left or bottom <= top:
            continue

        crop = img.crop((left, top, right, bottom))
        crop = crop.resize((config.SNIP_SIZE, config.SNIP_SIZE), Image.BILINEAR)

        crops.append(
            {
                "crop_image": crop,
                "bbox": detection["bbox"],
                "detection_confidence": detection["detection_confidence"],
                "stem": f"{stem}-{index}",
            }
        )

    return crops


def crop_animals(
    image_path: str | Path,
    detections: list[dict[str, Any]],
    output_dir: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Crop detections from a file on disk (legacy helper; prefer crop_animals_from_pil)."""
    image_path = Path(image_path)
    crops = crop_animals_from_pil(
        Image.open(image_path),
        detections,
        stem=image_path.stem,
    )

    if output_dir is None:
        return crops

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    persisted: list[dict[str, Any]] = []
    for crop in crops:
        crop_path = output_dir / f"{crop['stem']}{image_path.suffix}"
        crop["crop_image"].save(crop_path)
        persisted.append({**crop, "crop_path": str(crop_path)})

    return persisted
