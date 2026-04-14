"""User service for business logic operations."""
import logging

logger = logging.getLogger(__name__)


class UserBusinessService:
    """Handles user-related business operations."""

    def __init__(self) -> None:
        self._users: dict = {}

    def create_user(self, fields: dict) -> dict:
        """Create a new user with the given data."""
        user_id = str(len(self._users) + 1)
        user = {"id": user_id, **fields}
        self._users[user_id] = user
        return user

    def get_user(self, user_id: str) -> dict | None:
        """Retrieve a user by ID."""
        return self._users.get(user_id)

    def update_user(self, user_id: str, fields: dict) -> dict | None:
        """Update a user with new data."""
        if user_id not in self._users:
            return None
        self._users[user_id].update(fields)
        return self._users[user_id]

    def delete_user(self, user_id: str) -> bool:
        """Delete a user by ID."""
        if user_id in self._users:
            del self._users[user_id]
            return True
        return False
