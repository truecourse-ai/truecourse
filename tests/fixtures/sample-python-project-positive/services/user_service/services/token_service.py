"""Token management service for authentication."""
import logging
import secrets

logger = logging.getLogger(__name__)


class TokenService:
    """Manages authentication tokens."""

    def __init__(self) -> None:
        self._tokens: dict = {}

    def generate(self, user_id: str) -> str:
        """Generate a new token for a user."""
        token = secrets.token_urlsafe(32)
        self._tokens[token] = user_id
        return token

    def validate(self, token: str) -> bool:
        """Check if a token is valid."""
        return token in self._tokens

    def revoke(self, token: str) -> None:
        """Revoke a token."""
        self._tokens.pop(token, None)
