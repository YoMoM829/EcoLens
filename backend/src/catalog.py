"""Backend catalog abstraction for local JSON or OCI NoSQL storage."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

# NOTE: the `oci` SDK is imported lazily inside the OCI-only functions below,
# so local JSON mode boots without the heavy Oracle SDK installed.

DB_PATH = Path("/tmp/catalog.json")

OCI_TABLE_NAME = os.getenv("OCI_NOSQL_TABLE_NAME", "")
OCI_COMPARTMENT_OCID = os.getenv("OCI_NOSQL_COMPARTMENT_OCID", "")
OCI_REGION = os.getenv("OCI_REGION", "ap-melbourne-1")
OCI_TENANCY_OCID = os.getenv("OCI_TENANCY_OCID", "")
OCI_USER_OCID = os.getenv("OCI_USER_OCID", "")
OCI_FINGERPRINT = os.getenv("OCI_FINGERPRINT", "")
OCI_PRIVATE_KEY_PATH = os.getenv("OCI_PRIVATE_KEY_PATH", "")
OCI_PRIVATE_KEY_CONTENT = os.getenv("OCI_PRIVATE_KEY_CONTENT", "")
OCI_PASSPHRASE = os.getenv("OCI_PASSPHRASE", "")
OCI_SERVICE_ENDPOINT = os.getenv("OCI_NOSQL_ENDPOINT", "")

USE_OCI = os.getenv("USE_OCI_DB", "0") in ("1", "true", "True") or bool(
    OCI_TABLE_NAME and OCI_COMPARTMENT_OCID and OCI_TENANCY_OCID and OCI_USER_OCID and OCI_FINGERPRINT
)


def _ensure_db_exists() -> None:
    if not DB_PATH.exists():
        DB_PATH.write_text(json.dumps({"items": []}, indent=2))


def _load_local_items() -> List[Dict[str, Any]]:
    _ensure_db_exists()
    data = json.loads(DB_PATH.read_text())
    return data.get("items", [])


def _save_local_items(items: List[Dict[str, Any]]) -> None:
    DB_PATH.write_text(json.dumps({"items": items}, indent=2))


def _oci_config() -> dict[str, Any]:
    from oci.config import validate_config  # lazy, only needed in OCI mode
    config: dict[str, Any] = {
        "tenancy": OCI_TENANCY_OCID,
        "user": OCI_USER_OCID,
        "fingerprint": OCI_FINGERPRINT,
        "region": OCI_REGION,
    }
    if OCI_PRIVATE_KEY_CONTENT:
        config["key_content"] = OCI_PRIVATE_KEY_CONTENT
    elif OCI_PRIVATE_KEY_PATH:
        config["key_file"] = OCI_PRIVATE_KEY_PATH
    if OCI_PASSPHRASE:
        config["pass_phrase"] = OCI_PASSPHRASE
    validate_config(config)
    return config


@lru_cache(maxsize=1)
def _oci_client() -> "nosql_client.NosqlClient":
    from oci.nosql import nosql_client  # lazy, only needed in OCI mode
    config = _oci_config()
    kwargs: dict[str, Any] = {}
    if OCI_SERVICE_ENDPOINT:
        kwargs["service_endpoint"] = OCI_SERVICE_ENDPOINT
    return nosql_client.NosqlClient(config, **kwargs)


def _row_key(media_id: str) -> List[str]:
    return [f"media_id:{media_id}"]


def _query_all_rows() -> List[Dict[str, Any]]:
    if not USE_OCI:
        return _load_local_items()

    from oci.nosql.models import QueryDetails  # lazy, only needed in OCI mode
    statement = f"SELECT * FROM {OCI_TABLE_NAME}"
    query_details = QueryDetails(
        compartment_id=OCI_COMPARTMENT_OCID,
        statement=statement,
    )
    response = _oci_client().query(query_details)
    return list(response.data.items or [])


def load_all() -> List[Dict[str, Any]]:
    return _query_all_rows()


def save_all(items: List[Dict[str, Any]]) -> None:
    if not USE_OCI:
        _save_local_items(items)
        return

    current_by_id = {item.get("media_id"): item for item in _query_all_rows() if item.get("media_id")}
    desired_ids = {item.get("media_id") for item in items if item.get("media_id")}

    for removed_id in set(current_by_id) - desired_ids:
        delete_by_id(removed_id)

    for item in items:
        media_id = item.get("media_id")
        if not media_id:
            continue
        existing = find_by_id(media_id)
        if existing is None:
            add_item(item)
        else:
            update_item(media_id, item)


def find_by_id(media_id: str) -> Optional[Dict[str, Any]]:
    if not media_id:
        return None
    if not USE_OCI:
        for item in _load_local_items():
            if item.get("media_id") == media_id:
                return item
        return None

    from oci.exceptions import ServiceError  # lazy, only needed in OCI mode
    try:
        response = _oci_client().get_row(
            OCI_TABLE_NAME,
            _row_key(media_id),
            compartment_id=OCI_COMPARTMENT_OCID,
        )
    except ServiceError as exc:
        if exc.status == 404:
            return None
        raise
    row = response.data
    return dict(row.value) if row and row.value else None


def add_item(item: Dict[str, Any]) -> bool:
    """Insert if absent. Returns True if inserted, False if it already existed (dedup)."""
    media_id = item.get("media_id")
    if not USE_OCI:
        items = _load_local_items()
        # Dedup: don't insert if this media_id is already stored
        if any(it.get("media_id") == media_id for it in items):
            return False
        items.append(item)
        _save_local_items(items)
        return True

    from oci.nosql.models import UpdateRowDetails  # lazy, only needed in OCI mode
    details = UpdateRowDetails(
        compartment_id=OCI_COMPARTMENT_OCID,
        value=item,
        option=UpdateRowDetails.OPTION_IF_ABSENT,  # atomic insert-if-absent
        is_get_return_row=True,
    )
    resp = _oci_client().update_row(OCI_TABLE_NAME, details)
    # If a row was already present, OCI returns it. we did NOT insert (dedup hit)
    existing = getattr(resp.data, "existing_value", None)
    return existing is None


def update_item(media_id: str, updates: Dict[str, Any]) -> bool:
    if not media_id:
        return False

    if not USE_OCI:
        items = _load_local_items()
        changed = False
        for i, item in enumerate(items):
            if item.get("media_id") == media_id:
                items[i] = {**item, **updates}
                changed = True
                break
        if changed:
            _save_local_items(items)
        return changed

    current = find_by_id(media_id)
    if current is None:
        return False

    from oci.nosql.models import UpdateRowDetails  # lazy, only needed in OCI mode
    merged = {**current, **updates}
    details = UpdateRowDetails(
        compartment_id=OCI_COMPARTMENT_OCID,
        value=merged,
        option=UpdateRowDetails.OPTION_IF_PRESENT,
        is_get_return_row=True,
    )
    _oci_client().update_row(OCI_TABLE_NAME, details)
    return True


def delete_by_id(media_id: str) -> bool:
    """Delete a single row by its primary key. Returns True if it existed."""
    if not media_id:
        return False
    if not USE_OCI:
        items = _load_local_items()
        new_items = [i for i in items if i.get("media_id") != media_id]
        if len(new_items) == len(items):
            return False
        _save_local_items(new_items)
        return True

    from oci.exceptions import ServiceError  # lazy, only needed in OCI mode
    try:
        _oci_client().delete_row(OCI_TABLE_NAME, _row_key(media_id), compartment_id=OCI_COMPARTMENT_OCID)
        return True
    except ServiceError as exc:
        if exc.status == 404:
            return False
        raise
