"""Tests for DELETE /media — S3 removal and DB record deletion.

Shared-access model: any authenticated user may delete any file.
"""

import json
from unittest.mock import patch
from src import repository


def _delete(client_or_tc, urls: list):
    """Helper: send DELETE /media with a JSON body (TestClient.delete lacks json= arg)."""
    return client_or_tc.request(
        "DELETE", "/media",
        content=json.dumps({"urls": urls}),
        headers={"content-type": "application/json"},
    )


def _original_url(file_id="abc123"):
    from src.config import settings
    return (
        f"https://{settings.s3_upload_bucket}.s3.{settings.aws_region}"
        f".amazonaws.com/uploads/{file_id}.jpg"
    )


def test_delete_removes_db_record(client, seeded_record):
    """After a successful delete the record should no longer exist in the DB."""
    resp = _delete(client, [_original_url()])
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1
    assert repository.get_file_record("abc123") is None


def test_delete_calls_s3_for_original_thumbnail_and_detections(seeded_record, mock_user, tmp_path, monkeypatch):
    """Delete must remove original, thumbnail, and detections from their respective buckets."""
    from src.main import app
    from src.auth import verify_token
    from src import catalog
    from fastapi.testclient import TestClient

    monkeypatch.setattr(catalog, "DB_PATH", tmp_path / "catalog.json")
    repository.put_file_record(
        file_id="abc123", user_id="user-123", file_type="image",
        original_key="uploads/abc123.jpg",
        thumbnail_key="thumbnails/abc123.jpg",
        detections_key="detections/abc123.json",
        tags={"koala": 2}, animal_detected=True, top_confidence=0.9,
    )
    app.dependency_overrides[verify_token] = lambda: mock_user

    with patch("src.routers.media.s3") as mock_s3:
        mock_s3.delete_object.return_value = {}
        resp = _delete(TestClient(app), [_original_url()])

    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1

    deleted_buckets = {c.kwargs["Bucket"] for c in mock_s3.delete_object.call_args_list}
    from src.config import settings
    assert settings.s3_upload_bucket in deleted_buckets
    assert settings.s3_thumbnail_bucket in deleted_buckets
    assert settings.s3_detections_bucket in deleted_buckets

    app.dependency_overrides.clear()


def test_delete_unknown_url_skipped(client):
    """An URL with no matching DB record should be silently skipped."""
    resp = _delete(client, [_original_url("deadbeef")])
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0


def test_delete_any_user_can_delete(client, seeded_record, monkeypatch):
    """Shared-access: a different authenticated user can delete any file."""
    from src.main import app
    from src.auth import verify_token
    from fastapi.testclient import TestClient

    app.dependency_overrides[verify_token] = lambda: {
        "sub": "other-user", "email": "other@example.com", "token_use": "id",
    }
    resp = _delete(TestClient(app), [_original_url()])
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1   # succeeds — shared access
    assert repository.get_file_record("abc123") is None
    app.dependency_overrides.clear()


def test_delete_empty_url_list(client):
    """An empty URL list should succeed and report 0 deletions."""
    resp = _delete(client, [])
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0


# ---------------------------------------------------------------------------
# Tagging handler error handling (unchanged — S3 event Lambda, not REST API)
# ---------------------------------------------------------------------------

def test_lambda_handler_records_failed_status_on_error(tmp_path, monkeypatch):
    """If ML processing raises, lambda_handler should write a status=failed record."""
    from src import catalog, repository
    from src.tagging_handler import lambda_handler

    monkeypatch.setattr(catalog, "DB_PATH", tmp_path / "catalog.json")

    event = {"Records": [{"s3": {"bucket": {"name": "test-bucket"},
                                  "object": {"key": "uploads/abc123.jpg"}}}]}

    def boom(_bucket, _key, _run_ml):
        raise RuntimeError("ML pipeline exploded")

    with patch("src.tagging_handler.process_s3_object", side_effect=boom):
        response = lambda_handler(event, context=None)

    assert response["statusCode"] == 200
    result = response["results"][0]
    assert result["status"] == "failed"
    assert "ML pipeline exploded" in result["error"]

    record = repository.get_file_record("abc123")
    assert record is not None
    assert record.get("status") == "failed"


def test_lambda_handler_continues_after_one_failure(tmp_path, monkeypatch):
    """A failure on one S3 record must not prevent processing of subsequent records."""
    from src import catalog
    from src.tagging_handler import lambda_handler

    monkeypatch.setattr(catalog, "DB_PATH", tmp_path / "catalog.json")

    event = {"Records": [
        {"s3": {"bucket": {"name": "b"}, "object": {"key": "uploads/u/fail1.jpg"}}},
        {"s3": {"bucket": {"name": "b"}, "object": {"key": "uploads/u/ok2.jpg"}}},
    ]}

    call_count = {"n": 0}

    def selective_fail(bucket, key, run_ml):
        call_count["n"] += 1
        if "fail1" in key:
            raise RuntimeError("first record fails")
        return {"file_id": "ok2", "file_type": "image", "tags": {}}

    with patch("src.tagging_handler.process_s3_object", side_effect=selective_fail):
        response = lambda_handler(event, context=None)

    assert call_count["n"] == 2
    assert response["statusCode"] == 200
    assert len(response["results"]) == 2
    statuses = {r.get("status") for r in response["results"]}
    assert "failed" in statuses
