"""AWS operations and cloud service integrations."""
from __future__ import annotations

import json
import logging

import boto3
from botocore import exceptions as botocore_exceptions

logger = logging.getLogger(__name__)

s3 = boto3.client("s3")


def upload_to_s3(bucket: str, key: str, data: bytes) -> dict:
    """Upload data to an S3 bucket, handling ClientError correctly."""
    try:
        s3.put_object(Bucket=bucket, Key=key, Body=data)
    except botocore_exceptions.ClientError:
        logger.exception("S3 put_object failed")
        return {"ok": False}
    return {"ok": True, "bucket": bucket, "key": key, "size": len(data)}


def download_from_s3(bucket: str, key: str) -> bytes:
    """Download data from an S3 bucket, handling ClientError correctly."""
    try:
        response = s3.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()
    except botocore_exceptions.ClientError:
        logger.exception("S3 get_object failed")
        return b""


def parse_payload(raw: str) -> dict | None:
    """Parse a JSON payload safely.

    The try body has nothing to do with boto3 - the file just happens to
    use it elsewhere. The boto3-client-error rule must scope its detection
    to actual boto3 calls in the try body, not the file-level import.
    """
    try:
        return json.loads(raw)
    except Exception:
        logger.exception("payload parse failed")
        return None


def format_amount(value: float) -> str:
    """Format an amount with two decimals, swallowing unexpected errors.

    Same scope check as `parse_payload`: no boto3 call in the try body,
    so the rule must not fire even though the file imports boto3.
    """
    try:
        return f"{value:.2f}"
    except Exception:
        return "0.00"
