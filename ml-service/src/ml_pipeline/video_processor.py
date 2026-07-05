"""Video processing utilities for extracting frames and publishing video tags."""

from __future__ import annotations

import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

from . import config
from .classifier import classify_crops_batch
from .cropper import crop_animals_from_pil
from .detector import detect_animals_batch
from .inference import build_inference_result


def sample_video_frames(video_path: Path) -> list[tuple[int, np.ndarray]]:
    """Sample frames in memory using grab/retrieve to skip unneeded decodes."""
    cap = cv2.VideoCapture(str(video_path))

    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    source_fps = cap.get(cv2.CAP_PROP_FPS)
    if source_fps <= 0:
        source_fps = 30

    frame_interval = max(1, int(source_fps / config.VIDEO_FRAME_RATE))
    frames: list[tuple[int, np.ndarray]] = []
    frame_index = 0

    while True:
        if frame_index % frame_interval == 0:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append((frame_index, frame))
            if config.MAX_VIDEO_FRAMES > 0 and len(frames) >= config.MAX_VIDEO_FRAMES:
                break
        elif not cap.grab():
            break

        frame_index += 1

    cap.release()
    return frames


def _frame_label(frame_index: int) -> str:
    return f"frame:{frame_index}"


def process_video(video_path: str | Path) -> dict[str, Any]:
    """Run batched, in-memory video inference and return tags plus raw detections."""
    video_path = Path(video_path)
    sampled_frames = sample_video_frames(video_path)

    if not sampled_frames:
        return build_inference_result(
            source=str(video_path),
            file_type="video",
            tags={},
            detections=[],
            frames_processed=0,
        )

    max_tag_counts: Counter[str] = Counter()
    all_detections: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="ecolens-video-") as tmpdir:
        frame_paths: list[str] = []
        frame_images: list[Image.Image] = []
        frame_labels: list[str] = []

        for sample_index, (frame_index, frame) in enumerate(sampled_frames):
            frame_path = Path(tmpdir) / f"frame_{sample_index:05d}.jpg"
            cv2.imwrite(str(frame_path), frame)
            frame_paths.append(str(frame_path))
            frame_images.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
            frame_labels.append(_frame_label(frame_index))

        batch_detections = detect_animals_batch(frame_paths)

        pending_crops: list[dict[str, Any]] = []
        pending_frames: list[str] = []

        for frame_label, frame_image, detections in zip(frame_labels, frame_images, batch_detections):
            crops = crop_animals_from_pil(frame_image, detections, stem=frame_label.replace(":", "_"))
            pending_crops.extend(crops)
            pending_frames.extend([frame_label] * len(crops))

        if pending_crops:
            classifications = classify_crops_batch([crop["crop_image"] for crop in pending_crops])
            frame_tag_counts: dict[str, Counter[str]] = {}

            for crop, classification, frame_label in zip(pending_crops, classifications, pending_frames):
                species = classification["species"]
                confidence = classification["confidence"]

                if confidence < config.CLASSIFICATION_CONF_THRESHOLD:
                    continue

                frame_tag_counts.setdefault(frame_label, Counter())[species] += 1
                all_detections.append(
                    {
                        "species": species,
                        "classification_confidence": confidence,
                        "detection_confidence": crop["detection_confidence"],
                        "bbox": crop["bbox"],
                        "top_predictions": classification["top_predictions"],
                        "frame": frame_label,
                    }
                )

            for counter in frame_tag_counts.values():
                for species, count in counter.items():
                    max_tag_counts[species] = max(max_tag_counts[species], count)

    return build_inference_result(
        source=str(video_path),
        file_type="video",
        tags=dict(max_tag_counts),
        detections=all_detections,
        frames_processed=len(sampled_frames),
    )
