"""Authentication service for the user service."""
import logging
import secrets

logger = logging.getLogger(__name__)


class AuthService:
    """Handles user authentication and token management."""

    def __init__(self) -> None:
        self._tokens: dict = {}

    def login(self, username: str, password: str) -> dict:
        """Authenticate a user and return a token."""
        if not username or not password:
            return {"success": False}
        token = secrets.token_urlsafe(32)
        self._tokens[token] = username
        return {"success": True, "token": token}

    def verify(self, token: str) -> bool:
        """Verify an authentication token."""
        return token in self._tokens

    def logout(self, token: str) -> None:
        """Invalidate a session token."""
        self._tokens.pop(token, None)
