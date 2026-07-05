"""Pytest setup: shared fixtures for all backend tests."""

import os
import sys
import types
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Stub heavy optional dependencies before any app module is imported.
# This lets the test suite run without torch, cv2, or the OCI SDK installed.
# ---------------------------------------------------------------------------
for _mod in ("cv2", "torch", "torchvision", "PIL", "PIL.Image",
             "oci", "oci.config", "oci.nosql", "oci.nosql.nosql_client",
             "oci.nosql.models", "oci.exceptions", "megadetector", "ml_pipeline"):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# Minimal env so config + catalog import cleanly, and force local JSON mode.
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("COGNITO_USER_POOL_ID", "us-east-1_testpool")
os.environ.setdefault("COGNITO_CLIENT_ID", "test-client")
os.environ.setdefault("S3_UPLOAD_BUCKET", "test-uploads")
os.environ.setdefault("S3_THUMBNAIL_BUCKET", "test-thumbnails")
os.environ.setdefault("S3_DETECTIONS_BUCKET", "test-detections")
os.environ.setdefault("USE_OCI_DB", "0")


@pytest.fixture(autouse=True)
def _temp_catalog(tmp_path, monkeypatch):
    """Point the catalog at a fresh temp JSON file for every test."""
    from src import catalog
    monkeypatch.setattr(catalog, "DB_PATH", tmp_path / "catalog.json")
    yield


@pytest.fixture()
def mock_user():
    """Fake Cognito ID-token claims injected via verify_token override."""
    return {
        "sub": "user-123",
        "email": "test@example.com",
        "token_use": "id",
        "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool",
        "aud": "test-client",
        "exp": 9999999999,
    }


@pytest.fixture()
def client(mock_user):
    """TestClient with auth bypassed and AWS clients stubbed out."""
    from src.main import app
    from src.auth import verify_token

    # Bypass JWT verification for all tests
    app.dependency_overrides[verify_token] = lambda: mock_user

    with patch("src.routers.upload.s3") as mock_s3, \
         patch("src.routers.media.s3") as mock_s3_media, \
         patch("src.routers.notifications.notifier") as mock_notifier:

        mock_s3.generate_presigned_url.return_value = "https://s3.example.com/presigned"
        mock_s3.delete_object.return_value = {}
        mock_s3_media.delete_object.return_value = {}
        mock_notifier.subscribe.return_value = "arn:aws:sns:us-east-1:123:test-topic:sub-id"

        yield TestClient(app)

    app.dependency_overrides.clear()


@pytest.fixture()
def seeded_record(tmp_path, monkeypatch):
    """Insert one image record into the catalog and return it."""
    from src import catalog, repository
    monkeypatch.setattr(catalog, "DB_PATH", tmp_path / "catalog.json")

    repository.put_file_record(
        file_id="abc123",
        user_id="user-123",
        file_type="image",
        original_key="uploads/abc123.jpg",
        thumbnail_key="thumbnails/abc123.jpg",
        detections_key="detections/abc123.json",
        tags={"koala": 2, "wombat": 1},
        animal_detected=True,
        top_confidence=0.95,
    )
    return "abc123"
