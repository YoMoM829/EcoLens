"""Tests for POST /uploads — dedup check and presigned URL generation."""

from unittest.mock import patch


def test_presign_new_file_returns_upload_url(client):
    """A brand-new checksum should get a presigned PUT URL back."""
    resp = client.post("/uploads", json={
        "filename": "photo.jpg",
        "checksum": "a" * 64,
        "content_type": "image/jpeg",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["duplicate"] is False
    assert data["upload_url"] == "https://s3.example.com/presigned"
    assert "a" * 64 in data["file_url"]


def test_presign_duplicate_file_returns_no_upload_url(client, seeded_record):
    """A checksum already in the DB should be flagged as a duplicate."""
    resp = client.post("/uploads", json={
        "filename": "photo.jpg",
        "checksum": "abc123",
        "content_type": "image/jpeg",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["duplicate"] is True
    assert data["upload_url"] is None
    assert "abc123" in data["file_url"]


def test_presign_rejects_unsupported_extension(client):
    """Files with unsupported extensions should be rejected with 400."""
    resp = client.post("/uploads", json={
        "filename": "document.pdf",
        "checksum": "b" * 64,
        "content_type": "application/pdf",
    })
    assert resp.status_code == 400


def test_presign_requires_auth():
    """Requests without a valid token should be rejected."""
    from src.main import app
    from fastapi.testclient import TestClient
    plain_client = TestClient(app, raise_server_exceptions=False)
    resp = plain_client.post("/uploads", json={
        "filename": "photo.jpg",
        "checksum": "c" * 64,
        "content_type": "image/jpeg",
    })
    assert resp.status_code in (401, 403)
