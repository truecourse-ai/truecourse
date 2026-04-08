"""AWS infrastructure provisioning with security configurations."""
import json
import logging

logger = logging.getLogger(__name__)


class InfraStack:
    """Provisions AWS infrastructure resources."""

    def __init__(self, scope: object, stack_id: str) -> None:
        self.scope = scope
        self.stack_id = stack_id

    def create_iam_policy(self) -> dict:
        """Create an IAM policy with specific permissions."""
        return {
            "actions": ["s3:GetObject", "s3:PutObject"],
            "resources": [f"arn:aws:s3:::my-bucket-{self.stack_id}/*"],
        }

    def create_s3_bucket(self) -> dict:
        """Create an S3 bucket configuration."""
        return {
            "name": f"data-bucket-{self.stack_id}",
            "versioning": "enabled",
        }
