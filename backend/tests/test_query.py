"""Tests for media query endpoints:
  GET  /media?tag=...      — search by tag counts
  GET  /media?species=...  — search by species
  GET  /media/{file_id}    — resolve file_id to full-size URL
  POST /media/similar      — find similar by uploaded file
"""

from unittest.mock import patch
from io import BytesIO


def test_query_by_tags_match(client, seeded_record):
    """AND query matching min counts should return the file's result URL."""
    resp = client.get("/media?tag=koala:2&tag=wombat:1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    assert len(data["urls"]) == 1
    # Images are returned via their thumbnail URL
    assert "thumbnails" in data["urls"][0]


def test_query_by_tags_no_match_when_count_too_high(client, seeded_record):
    """Query requiring more than available should return empty."""
    resp = client.get("/media?tag=koala:5")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0
    assert data["urls"] == []


def test_query_by_tags_and_logic(client, seeded_record):
    """All species in the query must be present — a missing species yields no results."""
    resp = client.get("/media?tag=koala:1&tag=dingo:1")
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


def test_query_by_tags_empty_rejected(client):
    """No tag or species params should be rejected with 400."""
    resp = client.get("/media")
    assert resp.status_code == 400


def test_query_by_tags_invalid_format_rejected(client):
    """A tag param without ':count' should be rejected with 400."""
    resp = client.get("/media?tag=koala")
    assert resp.status_code == 400


def test_query_by_species_match(client, seeded_record):
    """Species query (count >= 1) should return the matching file."""
    resp = client.get("/media?species=koala")
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_query_by_species_no_match(client, seeded_record):
    """Species not present in DB returns empty."""
    resp = client.get("/media?species=dingo")
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


def test_get_media_by_id_returns_full_url(client, seeded_record):
    """GET /media/{file_id} should return the full-size original URL."""
    resp = client.get("/media/abc123")
    assert resp.status_code == 200
    file_url = resp.json()["file_url"]
    assert "uploads" in file_url
    assert "abc123" in file_url


def test_get_media_by_id_not_found(client):
    """Unknown file_id should return 404."""
    resp = client.get("/media/deadbeef")
    assert resp.status_code == 404


def test_presign_query_upload_returns_url(client):
    """POST /media/similar/presign should return a presigned upload_url and s3_key."""
    with patch("src.routers.media.s3") as mock_s3:
        mock_s3.generate_presigned_url.return_value = "https://s3.example.com/presigned-put"
        resp = client.post(
            "/media/similar/presign",
            data={"filename": "query.jpg", "content_type": "image/jpeg"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "upload_url" in data
    assert "s3_key" in data
    assert data["upload_url"] == "https://s3.example.com/presigned-put"
    assert data["s3_key"].endswith(".jpg")


def test_find_similar_returns_matches(client, seeded_record):
    """POST /media/similar with s3_key should invoke ML Lambda and return matching records.

    Flow: API Lambda invokes ML Lambda with s3_key → gets tags → queries DB → deletes temp.
    """
    import json as _json
    from unittest.mock import MagicMock

    fake_payload = MagicMock()
    fake_payload.read.return_value = _json.dumps({"tags": {"koala": 1}}).encode()
    fake_response = {"Payload": fake_payload}

    with patch("src.routers.media._lambda_client") as mock_lambda, \
         patch("src.routers.media.s3") as mock_s3:
        mock_lambda.invoke.return_value = fake_response
        mock_s3.delete_object.return_value = {}
        resp = client.post(
            "/media/similar",
            data={"s3_key": "abc-query-key.jpg"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    # Confirm temp file was deleted
    mock_s3.delete_object.assert_called_once()


def test_find_similar_no_tags_returns_empty(client, seeded_record):
    """If ML Lambda returns no tags, return empty results."""
    import json as _json
    from unittest.mock import MagicMock

    fake_payload = MagicMock()
    fake_payload.read.return_value = _json.dumps({"tags": {}}).encode()
    fake_response = {"Payload": fake_payload}

    with patch("src.routers.media._lambda_client") as mock_lambda, \
         patch("src.routers.media.s3") as mock_s3:
        mock_lambda.invoke.return_value = fake_response
        mock_s3.delete_object.return_value = {}
        resp = client.post(
            "/media/similar",
            data={"s3_key": "blank-key.jpg"},
        )

    assert resp.status_code == 200
    assert resp.json()["count"] == 0
