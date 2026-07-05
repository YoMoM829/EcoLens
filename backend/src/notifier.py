"""
Tag-based notifications via SNS


- subscribe(): subscribes an email to one or more species and SNS stores
"filter policy" so subscriber only gets emails about those species

- publish_new_file(): called after a file tagged then publishes the file's
species and SNS emails only subscribers whose filter matches

Eg. a user watching "koala" is emailed when a new koala file appears, but
not for other species.
"""

from __future__ import annotations

import json

import botocore.exceptions

from .aws import sns
from .config import settings


def publish_new_file(species: list[str], thumbnail_key: str | None = None) -> None:
    """Announce a newly tagged file to anyone watching its species.

    thumbnail_key is the raw S3 key stored in the DB (e.g. thumbnails/abc123.jpg).
    We build a plain (non-presigned) S3 URL from it — the bucket is private so the
    link is not directly clickable, but the URL contains the file_id which the
    EcoLens frontend can use with "Find by thumbnail URL" to locate the file.
    """
    # No topic configured (e.g. local dev) or no species so nothing to send
    if not settings.sns_topic_arn or not species:
        return
    species_list = ", ".join(species)

    # Build plain S3 URL — only the path structure matters for frontend lookup,
    # not whether the object is publicly accessible.
    lookup_section = ""
    if thumbnail_key:
        plain_url = (
            f"https://{settings.s3_thumbnail_bucket}"
            f".s3.{settings.aws_region}.amazonaws.com/{thumbnail_key}"
        )
        lookup_section = (
            f"\n\nTo view this file, paste the following URL into the "
            f"'Find by Thumbnail URL' field in EcoLens:\n  {plain_url}"
        )

    sns.publish(
        TopicArn=settings.sns_topic_arn,
        Subject="EcoLens: New wildlife detected",
        Message=(
            f"A new file has been uploaded to EcoLens and tagged with the following species:\n\n"
            f"  {species_list}"
            f"{lookup_section}"
        ),
        # SNS matches this against each subscriber's filter policy
        MessageAttributes={
            "species": {"DataType": "String.Array", "StringValue": json.dumps(species)},
        },
    )


def _find_subscription(email: str, include_pending: bool = False) -> dict | None:
    """Return the SNS subscription dict for this email, or None.

    By default only returns confirmed subscriptions.  Pass include_pending=True
    to also match subscriptions still awaiting email confirmation.

    Raises ValueError on any SNS/network error so callers get a clean 503.
    """
    try:
        paginator = sns.get_paginator("list_subscriptions_by_topic")
        for page in paginator.paginate(TopicArn=settings.sns_topic_arn):
            for sub in page.get("Subscriptions", []):
                if sub.get("Endpoint") != email:
                    continue
                arn = sub.get("SubscriptionArn", "")
                if arn == "Deleted":
                    continue
                if not include_pending and arn == "PendingConfirmation":
                    continue
                return sub
        return None
    except botocore.exceptions.ClientError as exc:
        code = exc.response["Error"]["Code"]
        msg = exc.response["Error"]["Message"]
        raise ValueError(f"SNS error looking up subscription ({code}): {msg}") from exc
    except Exception as exc:
        raise ValueError(f"SNS error looking up subscription: {exc}") from exc


def get_subscription(email: str) -> dict | None:
    """Return subscription details for this email, or None if not subscribed.

    Returns status "pending_confirmation" for subscriptions awaiting email
    confirmation, and "confirmed" for active subscriptions.
    """
    if not settings.sns_topic_arn:
        raise ValueError("SNS_TOPIC_ARN is not configured")
    sub = _find_subscription(email, include_pending=True)
    if not sub:
        return None
    arn = sub["SubscriptionArn"]
    if arn == "PendingConfirmation":
        return {
            "subscription_arn": "PendingConfirmation",
            "species": [],
            "status": "pending_confirmation",
        }
    try:
        attrs = sns.get_subscription_attributes(SubscriptionArn=arn)["Attributes"]
    except botocore.exceptions.ClientError as exc:
        code = exc.response["Error"]["Code"]
        msg = exc.response["Error"]["Message"]
        raise ValueError(f"SNS error reading subscription ({code}): {msg}") from exc
    except Exception as exc:
        raise ValueError(f"SNS error reading subscription: {exc}") from exc
    raw_policy = attrs.get("FilterPolicy", "{}")
    species = json.loads(raw_policy).get("species", [])
    return {
        "subscription_arn": arn,
        "species": species,
        "status": "confirmed",
    }


def unsubscribe(email: str) -> bool:
    """Unsubscribe the email from all alerts. Returns True if a subscription was found."""
    if not settings.sns_topic_arn:
        raise ValueError("SNS_TOPIC_ARN is not configured")
    sub = _find_subscription(email)
    if not sub:
        return False
    try:
        sns.unsubscribe(SubscriptionArn=sub["SubscriptionArn"])
    except botocore.exceptions.ClientError as exc:
        code = exc.response["Error"]["Code"]
        msg = exc.response["Error"]["Message"]
        raise ValueError(f"SNS error cancelling subscription ({code}): {msg}") from exc
    except Exception as exc:
        raise ValueError(f"SNS error cancelling subscription: {exc}") from exc
    return True


def subscribe(email: str, species: list[str]) -> str:
    """Subscribe an email to alerts for the given species. Returns the ARN.

    If the email already has a confirmed subscription, updates its filter
    policy in-place via set_subscription_attributes instead of re-subscribing.
    """
    if not settings.sns_topic_arn:
        raise ValueError("SNS_TOPIC_ARN is not configured")

    try:
        resp = sns.subscribe(
            TopicArn=settings.sns_topic_arn,
            Protocol="email",
            Endpoint=email,
            Attributes={"FilterPolicy": json.dumps({"species": species})},
            ReturnSubscriptionArn=True,
        )
        return resp["SubscriptionArn"]
    except botocore.exceptions.ClientError as exc:
        code = exc.response["Error"]["Code"]
        msg = exc.response["Error"]["Message"]

        if code == "InvalidParameter" and "different attributes" in msg:
            # A subscription (confirmed or pending) already exists with different
            # attributes.  For confirmed: update the filter policy in-place.
            # For pending: cancel it and re-subscribe fresh.
            existing = _find_subscription(email, include_pending=True)
            if existing:
                arn = existing["SubscriptionArn"]
                if arn == "PendingConfirmation":
                    # Can't update a pending subscription — cancel and retry.
                    try:
                        sns.unsubscribe(SubscriptionArn=arn)
                    except Exception:
                        pass  # best-effort; re-subscribe below regardless
                    try:
                        resp2 = sns.subscribe(
                            TopicArn=settings.sns_topic_arn,
                            Protocol="email",
                            Endpoint=email,
                            Attributes={"FilterPolicy": json.dumps({"species": species})},
                            ReturnSubscriptionArn=True,
                        )
                        return resp2["SubscriptionArn"]
                    except Exception as retry_exc:
                        raise ValueError(f"SNS subscribe failed after clearing pending: {retry_exc}") from retry_exc
                else:
                    # Confirmed — update filter policy in-place.
                    try:
                        sns.set_subscription_attributes(
                            SubscriptionArn=arn,
                            AttributeName="FilterPolicy",
                            AttributeValue=json.dumps({"species": species}),
                        )
                    except botocore.exceptions.ClientError as update_exc:
                        uc = update_exc.response["Error"]["Code"]
                        um = update_exc.response["Error"]["Message"]
                        raise ValueError(f"SNS error updating subscription ({uc}): {um}") from update_exc
                    except Exception as update_exc:
                        raise ValueError(f"SNS error updating subscription: {update_exc}") from update_exc
                    return arn
            raise ValueError("Could not locate existing subscription to update.") from exc

        if code == "InvalidParameter" and "pending" in msg.lower():
            raise ValueError(
                "You have a pending subscription confirmation. "
                "Please click the confirmation link in your email before changing species."
            ) from exc

        raise ValueError(f"SNS error ({code}): {msg}") from exc
    except Exception as exc:
        raise ValueError(f"SNS subscribe failed: {exc}") from exc
