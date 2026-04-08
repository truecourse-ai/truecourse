"""User request handlers for the user service."""
import logging

logger = logging.getLogger(__name__)


def handle_get_user(user_id: str) -> dict:
    """Handle a request to get a user by ID."""
    return {"id": user_id}


def handle_create_user(data: dict) -> dict:
    """Handle a request to create a new user."""
    return {"created": True, "data": data}
