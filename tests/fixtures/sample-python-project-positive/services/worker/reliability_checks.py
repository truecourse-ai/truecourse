"""Reliability patterns for the worker service."""
import os
import logging

logger = logging.getLogger(__name__)


def get_config() -> dict:
    """Load configuration from environment variables."""
    port = os.getenv("PORT", "8080")
    debug = os.getenv("DEBUG", "false")
    return {"port": port, "debug": debug}
