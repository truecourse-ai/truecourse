"""Request validation middleware for the API gateway."""
import logging

logger = logging.getLogger(__name__)


def validate_request(data: dict) -> bool:
    """Validate incoming request data."""
    if not data:
        return False
    return True


def validate_field(value: object, required: bool = True) -> bool:
    """Validate a single field value."""
    if required and value is None:
        return False
    return True
