"""
Centralised config loaded from environment variables (or a local `.env`)

Pydantic validates the values at startup, so a missing/typo'd variable
fails fast on import rather than at the first request. In Lambda, set
these as function environment variables
"""

import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # AWS_REGION is reserved by Lambda and cannot be set manually.
    # Lambda sets AWS_DEFAULT_REGION automatically — read that instead.
    aws_region: str = os.getenv("AWS_DEFAULT_REGION", "ap-southeast-4")
    cognito_user_pool_id: str = ""  # which Cognito pool issues tokens
    cognito_client_id: str = ""     # app client ID used as JWT audience
    s3_upload_bucket: str = ""       # raw user uploads land here
    s3_thumbnail_bucket: str = ""    # thumbnails are written here
    s3_detections_bucket: str = ""   # raw ML detection JSON stored here
    s3_query_temp_bucket: str = ""   # temp files for query-by-file (deleted after inference)
    oci_nosql_table_name: str = ""
    oci_nosql_compartment_ocid: str = ""
    oci_region: str = ""
    oci_tenancy_ocid: str = ""
    oci_user_ocid: str = ""
    oci_fingerprint: str = ""
    oci_private_key_path: str | None = None
    oci_private_key_content: str | None = None
    oci_passphrase: str | None = None
    oci_nosql_endpoint: str | None = None
    sns_topic_arn: str | None = None  # optional: tag-based notifications
    frontend_origin: str | None = None  # CloudFront domain, e.g. https://d123abc.cloudfront.net
    ml_lambda_name: str = ""  # ML Lambda function name for query-by-file invocations

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


# Singleton import this from anywhere instead of re-instantiating
settings = Settings() 