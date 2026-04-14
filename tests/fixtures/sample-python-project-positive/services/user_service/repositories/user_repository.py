"""User repository for data access operations."""
import os
import logging
import requests

logger = logging.getLogger(__name__)

USER_API_URL = os.environ.get("USER_API_URL", "http://localhost:3001")
HTTP_TIMEOUT = 30


class UserRepository:
    """Manages user data persistence and retrieval."""

    def __init__(self) -> None:
        self._users: dict = {}

    def find_by_id(self, user_id: str) -> dict | None:
        """Find a user by their unique identifier."""
        return self._users.get(user_id)

    def save(self, user: dict) -> dict:
        """Save a user record."""
        user_id = user.get("id") or ""
        self._users[user_id] = user
        return user

    def delete(self, user_id: str) -> bool:
        """Delete a user by ID."""
        if user_id in self._users:
            del self._users[user_id]
            return True
        return False

    def find_all(self) -> list:
        """Return all users."""
        return [self._users[uid] for uid in self._users]
