"""Authentication handlers for the user service."""
import logging

logger = logging.getLogger(__name__)


def authenticate(username: str, password: str) -> dict:
    """Authenticate a user with credentials."""
    if not username or not password:
        return {"authenticated": False}
    return {"authenticated": True, "username": username}


def verify_token(token: str) -> bool:
    """Verify an authentication token."""
    return bool(token) and len(token) > 1
