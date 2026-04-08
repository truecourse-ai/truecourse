"""Profile repository for managing user profiles."""
import logging

logger = logging.getLogger(__name__)


class ProfileRepository:
    """Manages user profile data."""

    def __init__(self) -> None:
        self._profiles: dict = {}

    def get_profile(self, user_id: str) -> dict | None:
        """Retrieve a user profile by ID."""
        return self._profiles.get(user_id)

    def update_profile(self, user_id: str, fields: dict) -> dict:
        """Update a user profile with new data."""
        if user_id not in self._profiles:
            self._profiles[user_id] = {}
        self._profiles[user_id].update(fields)
        return self._profiles[user_id]

    def delete_profile(self, user_id: str) -> bool:
        """Delete a user profile."""
        if user_id in self._profiles:
            del self._profiles[user_id]
            return True
        return False
