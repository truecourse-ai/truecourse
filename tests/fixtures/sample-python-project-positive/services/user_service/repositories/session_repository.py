"""Session repository for managing user sessions."""
import logging

logger = logging.getLogger(__name__)


class SessionRepository:
    """Manages user session persistence."""

    def __init__(self) -> None:
        self._sessions: dict = {}

    def create(self, user_id: str, token: str) -> dict:
        """Create a new session for a user."""
        session = {"user_id": user_id, "token": token, "active": True}
        self._sessions[token] = session
        return session

    def find_by_token(self, token: str) -> dict | None:
        """Find a session by its token."""
        return self._sessions.get(token)

    def delete(self, token: str) -> bool:
        """Delete a session by token."""
        if token in self._sessions:
            del self._sessions[token]
            return True
        return False

    def delete_all_for_user(self, user_id: str) -> int:
        """Delete all sessions for a specific user."""
        to_delete = [t for t, s in self._sessions.items() if s["user_id"] == user_id]
        for token in to_delete:
            del self._sessions[token]
        return len(to_delete)
