"""Session management service for user authentication."""
import logging
import secrets

logger = logging.getLogger(__name__)


class SessionService:
    """Manages user sessions and session lifecycle."""

    def __init__(self) -> None:
        self._sessions: dict = {}

    def create_session(self, user_id: str) -> str:
        """Create a new session and return the session token."""
        token = secrets.token_urlsafe(32)
        self._sessions[token] = {"user_id": user_id, "active": True}
        return token

    def validate_session(self, token: str) -> bool:
        """Check whether a session token is valid."""
        entry = self._sessions.get(token)
        if entry is None:
            return False
        return entry.get("active") is not False

    def destroy_session(self, token: str) -> None:
        """Destroy an active session."""
        self._sessions.pop(token, None)
