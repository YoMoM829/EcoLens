"""Species classification utilities for EcoLens cropped animal images."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import torch
import torchvision.transforms as transforms
from PIL import Image

from . import config
from .classes import CLASSES
from .model_loader import get_device, load_species_model

_transform = transforms.Compose(
    [
        transforms.Resize((config.CLASSIFICATION_IMAGE_SIZE, config.CLASSIFICATION_IMAGE_SIZE)),
        transforms.ToTensor(),
    ]
)


def _classification_from_probs(probs: np.ndarray, top_k: int) -> dict[str, Any]:
    order = np.argsort(probs)[::-1]
    best_idx = int(order[0])
    return {
        "species": CLASSES[best_idx],
        "confidence": float(probs[best_idx]),
        "top_predictions": [
            {
                "species": CLASSES[int(idx)],
                "confidence": float(probs[int(idx)]),
            }
            for idx in order[:top_k]
        ],
    }


@torch.no_grad()
def classify_crops_batch(crop_images: list[Image.Image], top_k: int = 5) -> list[dict[str, Any]]:
    """Classify multiple cropped images in as few forward passes as possible."""
    if not crop_images:
        return []

    model = load_species_model()
    device = get_device()
    results: list[dict[str, Any]] = []
    batch_size = max(1, config.CLASSIFIER_BATCH_SIZE)

    for start in range(0, len(crop_images), batch_size):
        chunk = crop_images[start : start + batch_size]
        tensors = [_transform(image.convert("RGB")) for image in chunk]
        batch = torch.stack(tensors).to(device)
        batch = batch.permute(0, 2, 3, 1)

        logits = model(batch)
        probs = torch.softmax(logits, dim=1).detach().cpu().numpy()

        for row in probs:
            results.append(_classification_from_probs(row, top_k))

    return results


@torch.no_grad()
def classify_crop(crop_path: str | Path, top_k: int = 5) -> dict[str, Any]:
    """Classify a single cropped image from disk."""
    results = classify_crops_batch([Image.open(crop_path)], top_k=top_k)
    return results[0]
