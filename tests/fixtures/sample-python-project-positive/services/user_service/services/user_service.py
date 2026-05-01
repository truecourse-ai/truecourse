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

    def list_users(
        self,
        filters: dict | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> list[dict]:
        """List users with optional filters. Default is None — the recommended
        idiom for an optional dict-shaped argument. mutable-default-arg should
        not flag the `dict | None = None` signature."""
        results = list(self._users.values())
        if filters:
            results = [u for u in results if all(u.get(k) == v for k, v in filters.items())]
        offset = (page - 1) * page_size
        return results[offset : offset + page_size]

    def fetch_audit_records(
        self,
        user_ids: list[str] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> list[dict]:
        """Both arguments default to None even though the type hint mentions
        list / dict — the actual default value is None, not a mutable."""
        ids = user_ids or list(self._users.keys())
        _ = extra_headers
        return [{"user_id": uid, "audited": True} for uid in ids]
