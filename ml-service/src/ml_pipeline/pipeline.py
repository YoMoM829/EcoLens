"""High-level ML pipeline for EcoLens image and video tagging."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image

from . import config
from .classifier import classify_crops_batch
from .cropper import crop_animals_from_pil
from .detector import detect_animals_batch
from .inference import aggregate_classifications, build_inference_result
from .metadata import build_metadata_record, sha256_file


def process_image(image_path: str | Path) -> dict[str, Any]:
    """Run animal detection and species classification on a single image."""
    image_path = Path(image_path)
    detections = detect_animals_batch([image_path])[0]
    image = Image.open(image_path).convert("RGB")
    crops = crop_animals_from_pil(image, detections, stem=image_path.stem)

    if not crops:
        return build_inference_result(
            source=str(image_path),
            file_type="image",
            tags={},
            detections=[],
        )

    classifications = classify_crops_batch([crop["crop_image"] for crop in crops])
    tags, enriched_detections = aggregate_classifications(crops, classifications)

    return build_inference_result(
        source=str(image_path),
        file_type="image",
        tags=tags,
        detections=enriched_detections,
    )


def process_file(
    file_path: str | Path,
    *,
    user_id: str = "local-user",
    file_id: str | None = None,
    status: str = "processed",
) -> dict[str, Any]:
    """Run inference and return a catalog metadata record for the media file."""
    file_path = Path(file_path)
    suffix = file_path.suffix.lower()

    if suffix in config.IMAGE_EXTENSIONS:
        inference = process_image(file_path)
    elif suffix in config.VIDEO_EXTENSIONS:
        from .video_processor import process_video

        inference = process_video(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")

    resolved_file_id = file_id or sha256_file(file_path)
    return build_metadata_record(
        file_id=resolved_file_id,
        user_id=user_id,
        file_path=file_path,
        file_type=inference["file_type"],
        tags=inference["tags"],
        detections=inference.get("detections", []),
        status=status,
    )
