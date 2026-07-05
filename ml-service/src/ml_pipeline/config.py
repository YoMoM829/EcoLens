"""Configuration constants for the EcoLens ML pipeline.

Values are primarily loaded from environment variables with sensible
local defaults for development and testing.
"""

import os
from pathlib import Path

AWS_REGION = os.getenv("AWS_DEFAULT_REGION", os.getenv("AWS_REGION", "ap-southeast-4"))

SERVICE_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = SERVICE_ROOT / "models"

# Local file paths — used directly when running outside Lambda.
# In Lambda, set the S3 vars below instead; model_loader.py will download
# the files to /tmp at cold start and override these paths automatically.
MEGADETECTOR_PATH = os.getenv("MEGADETECTOR_PATH", str(MODELS_DIR / "mdv5a.pt"))
SPECIES_MODEL_PATH = os.getenv("SPECIES_MODEL_PATH", str(MODELS_DIR / "model.pt"))

# S3 source for model artefacts (optional).
# When set, model_loader.py downloads the model to /tmp at cold start so a
# new model version can be deployed by updating env vars only (req 4.1.1).
MEGADETECTOR_S3_BUCKET = os.getenv("MEGADETECTOR_S3_BUCKET", "")
MEGADETECTOR_S3_KEY = os.getenv("MEGADETECTOR_S3_KEY", "")
MODEL_S3_BUCKET = os.getenv("MODEL_S3_BUCKET", "")
MODEL_S3_KEY = os.getenv("MODEL_S3_KEY", "")

CROP_OUTPUT_DIR = Path(os.getenv("CROP_OUTPUT_DIR", "/tmp/cropped_images"))
FRAME_OUTPUT_DIR = Path(os.getenv("FRAME_OUTPUT_DIR", "/tmp/video_frames"))

ANIMAL_CATEGORY_ID = os.getenv("ANIMAL_CATEGORY_ID", "1")
LOWER_CONF = float(os.getenv("LOWER_CONF", "0.05"))
SNIP_SIZE = int(os.getenv("SNIP_SIZE", "384"))

CLASSIFICATION_IMAGE_SIZE = int(os.getenv("CLASSIFICATION_IMAGE_SIZE", "384"))
CLASSIFICATION_CONF_THRESHOLD = float(os.getenv("CLASSIFICATION_CONF_THRESHOLD", "0.8"))

SAVE_DETECTION_JSON = os.getenv("SAVE_DETECTION_JSON", "false").lower() == "true"
DETECTION_JSON_PATH = os.getenv("DETECTION_JSON_PATH", "/tmp/mg_detections.json")

VIDEO_FRAME_RATE = float(os.getenv("VIDEO_FRAME_RATE", "1"))
MAX_VIDEO_FRAMES = int(os.getenv("MAX_VIDEO_FRAMES", "0"))
DETECTOR_BATCH_SIZE = int(os.getenv("DETECTOR_BATCH_SIZE", "8"))
CLASSIFIER_BATCH_SIZE = int(os.getenv("CLASSIFIER_BATCH_SIZE", "32"))

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
