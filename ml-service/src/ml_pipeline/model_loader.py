"""Lazy model loader for the MegaDetector and species classifier models.

When S3 source env vars are configured (MEGADETECTOR_S3_BUCKET / MODEL_S3_BUCKET
etc.), models are downloaded to /tmp at cold start and loaded from there.
Switching to a new model version requires only updating Lambda env vars — no
code or package changes needed (satisfies requirement 4.1.1).
"""

from __future__ import annotations

import os
from pathlib import Path

import boto3
import torch

from . import config

_device = None
_species_model = None
_megadetector_model_path = None


def _download_from_s3(bucket: str, key: str, local_path: Path) -> None:
    """Download a file from S3 to local_path if it isn't already there."""
    if local_path.exists():
        return
    print(f"[model_loader] Downloading s3://{bucket}/{key} → {local_path}")
    local_path.parent.mkdir(parents=True, exist_ok=True)
    s3 = boto3.client("s3", region_name=os.getenv("AWS_DEFAULT_REGION", os.getenv("AWS_REGION", "ap-southeast-4")))
    s3.download_file(bucket, key, str(local_path))
    print(f"[model_loader] Download complete: {local_path}")


def _resolve_megadetector_path() -> str:
    """Return the local path to the MegaDetector weights, downloading from S3 if needed."""
    if config.MEGADETECTOR_S3_BUCKET and config.MEGADETECTOR_S3_KEY:
        filename = Path(config.MEGADETECTOR_S3_KEY).name
        local_path = Path("/tmp/models") / filename
        _download_from_s3(config.MEGADETECTOR_S3_BUCKET, config.MEGADETECTOR_S3_KEY, local_path)
        return str(local_path)
    return config.MEGADETECTOR_PATH


def _resolve_species_model_path() -> str:
    """Return the local path to the species classifier weights, downloading from S3 if needed."""
    if config.MODEL_S3_BUCKET and config.MODEL_S3_KEY:
        filename = Path(config.MODEL_S3_KEY).name
        local_path = Path("/tmp/models") / filename
        _download_from_s3(config.MODEL_S3_BUCKET, config.MODEL_S3_KEY, local_path)
        return str(local_path)
    return config.SPECIES_MODEL_PATH


def get_device() -> str:
    """Choose the best available Torch device for model execution."""
    global _device

    if _device is not None:
        return _device

    if torch.cuda.is_available():
        _device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        _device = "mps"
    else:
        _device = "cpu"

    return _device


def load_species_model():
    """Load and cache the species classification model for later inference."""
    global _species_model

    if _species_model is not None:
        return _species_model

    device = get_device()
    path = _resolve_species_model_path()

    model = torch.load(
        path,
        map_location=device,
        weights_only=False,
    )

    model.eval()
    model.to(device)

    _species_model = model
    return _species_model


def load_megadetector_model_path() -> str:
    """Return the local path to the MegaDetector model, downloading from S3 if needed."""
    global _megadetector_model_path

    if _megadetector_model_path is None:
        _megadetector_model_path = _resolve_megadetector_path()

    return _megadetector_model_path
