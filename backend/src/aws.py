"""
Shared boto3 clients.

Created once at module import so all requests reuse
same connection pool (avoiding TCP/TLS setup on every call)
"""

import boto3
from .config import settings

s3 = boto3.client(
    "s3",
    region_name=settings.aws_region,
    endpoint_url=f"https://s3.{settings.aws_region}.amazonaws.com",
)
sns = boto3.client("sns", region_name=settings.aws_region)      # tag-based notifications