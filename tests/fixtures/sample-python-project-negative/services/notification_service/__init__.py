"""Notification service package."""
# VIOLATION: code-quality/deterministic/non-empty-init-module
from .email_sender import send_email
from .queue_processor import process_queue

DEFAULT_RETRY_COUNT = 3


def get_default_config():
    """Return default notification config."""
    return {
        "retry_count": DEFAULT_RETRY_COUNT,
        "timeout": 30,
    }
