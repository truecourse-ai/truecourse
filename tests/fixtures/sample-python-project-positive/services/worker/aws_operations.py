"""AWS operations and cloud service integrations."""
import logging

logger = logging.getLogger(__name__)


def upload_to_s3(bucket: str, key: str, data: bytes) -> dict:
    """Upload data to an S3 bucket."""
    return {"bucket": bucket, "key": key, "size": len(data)}


def download_from_s3(bucket: str, key: str) -> bytes:
    """Download data from an S3 bucket."""
    return b""
