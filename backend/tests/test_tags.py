"""Tests for PATCH /media/tags — bulk add and remove.

Shared-access model: any authenticated user may edit tags on any file.
"""

from src import repository


def test_bulk_add_new_tag(client, seeded_record):
    """Adding a tag not already on the file should insert it with count 1."""
    from src.config import settings
    url = (
        f"https://{settings.s3_upload_bucket}.s3.{settings.aws_region}"
        f".amazonaws.com/uploads/abc123.jpg"
    )
    resp = client.post("/media/tags", json={
        "urls": [url],
        "tags": ["dingo"],
        "operation": 1,
    })
    assert resp.status_code == 200
    assert resp.json()["updated"] == 1

    record = repository.get_file_record("abc123")
    assert "dingo" in record["tags"]
    assert record["tags"]["dingo"] == 1


def test_bulk_add_existing_tag_preserves_count(client, seeded_record):
    """Adding a tag already present must not change its existing count."""
    from src.config import settings
    url = (
        f"https://{settings.s3_upload_bucket}.s3.{settings.aws_region}"
        f".amazonaws.com/uploads/abc123.jpg"
    )
    resp = client.post("/media/tags", json={
        "urls": [url],
        "tags": ["koala"],
        "operation": 1,
    })
    assert resp.status_code == 200
    record = repository.get_file_record("abc123")
    # Original count was 2 — must remain 2
    assert record["tags"]["koala"] == 2


def test_bulk_remove_tag(client, seeded_record):
    """Removing an existing tag should delete it from the record."""
    from src.config import settings
    url = (
        f"https://{settings.s3_upload_bucket}.s3.{settings.aws_region}"
        f".amazonaws.com/uploads/abc123.jpg"
    )
    resp = client.post("/media/tags", json={
        "urls": [url],
        "tags": ["wombat"],
        "operation": 0,
    })
    assert resp.status_code == 200
    assert resp.json()["updated"] == 1
    record = repository.get_file_record("abc123")
    assert "wombat" not in record["tags"]


def test_bulk_remove_absent_tag_is_ignored(client, seeded_record):
    """Removing a tag not on the file should be silently ignored."""
    from src.config import settings
    url = (
        f"https://{settings.s3_upload_bucket}.s3.{settings.aws_region}"
        f".amazonaws.com/uploads/abc123.jpg"
    )
    resp = client.post("/media/tags", json={
        "urls": [url],
        "tags": ["dingo"],
        "operation": 0,
    })
    assert resp.status_code == 200
    record = repository.get_file_record("abc123")
    assert set(record["tags"].keys()) == {"koala", "wombat"}


def test_bulk_edit_unknown_url_skipped(client):
    """An URL that doesn't map to any record should be silently skipped."""
    resp = client.post("/media/tags", json={
        "urls": ["https://bucket.s3.us-east-1.amazonaws.com/uploads/u/unknown.jpg"],
        "tags": ["koala"],
        "operation": 1,
    })
    assert resp.status_code == 200
    assert resp.json()["updated"] == 0


def test_bulk_edit_any_user_can_edit(client, seeded_record):
    """Shared-access: a different authenticated user can also edit tags."""
    from src.main import app
    from src.auth import verify_token
    from src.config import settings
    from fastapi.testclient import TestClient

    # Override with a different user — shared access means this should succeed
    app.dependency_overrides[verify_token] = lambda: {
        "sub": "other-user",
        "email": "other@example.com",
        "token_use": "id",
    }
    url = (
        f"https://{settings.s3_upload_bucket}.s3.{settings.aws_region}"
        f".amazonaws.com/uploads/abc123.jpg"
    )
    resp = TestClient(app).post("/media/tags", json={
        "urls": [url], "tags": ["dingo"], "operation": 1,
    })
    assert resp.status_code == 200
    assert resp.json()["updated"] == 1   # succeeds — shared access
    app.dependency_overrides.clear()
