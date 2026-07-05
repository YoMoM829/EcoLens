"""
Subscriptions router — RESTful resource for species-watch notification subscriptions.

  GET    /subscriptions   → get the current user's subscription (species + status)
  POST   /subscriptions   → create or update the current user's subscription
  DELETE /subscriptions   → cancel the current user's subscription
"""

from fastapi import APIRouter, HTTPException

from ..auth import CurrentUser
from ..schemas import SubscribeRequest
from .. import notifier

router = APIRouter()


def _require_email(user: dict) -> str:
    email = user.get("email")
    if not email:
        raise HTTPException(400, "No email address found in your account")
    return email


@router.get("/")
def get_subscription(user: CurrentUser):
    """Return the current user's SNS subscription details, or null if none."""
    email = _require_email(user)
    try:
        sub = notifier.get_subscription(email)
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc
    return sub  # None → JSON null, or {subscription_arn, species, status}


@router.post("/")
def create_subscription(body: SubscribeRequest, user: CurrentUser):
    """
    Subscribe to (or update) email alerts for the given species.
    Uses the authenticated user's Cognito email — no email override.
    """
    if not body.species:
        raise HTTPException(400, "Provide at least one species to watch")
    email = _require_email(user)
    try:
        arn = notifier.subscribe(email, body.species)
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"subscription_arn": arn, "pending_confirmation": True}


@router.delete("/")
def cancel_subscription(user: CurrentUser):
    """Unsubscribe the current user from all species alerts."""
    email = _require_email(user)
    try:
        cancelled = notifier.unsubscribe(email)
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc
    if not cancelled:
        raise HTTPException(404, "No active subscription found")
    return {"cancelled": True}
