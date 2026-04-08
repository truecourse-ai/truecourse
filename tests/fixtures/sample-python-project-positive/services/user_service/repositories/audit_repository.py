"""Audit repository for tracking user actions."""
import logging

logger = logging.getLogger(__name__)


class AuditRepository:
    """Records audit trail entries for user actions."""

    def __init__(self) -> None:
        self._entries: list = []

    def log_action(self, user_id: str, action: str) -> None:
        """Record a user action in the audit log."""
        self._entries.append({"user_id": user_id, "action": action})

    def get_entries(self, user_id: str | None = None) -> list:
        """Retrieve audit entries, optionally filtered by user."""
        if user_id:
            return [e for e in self._entries if e["user_id"] == user_id]
        return list(self._entries)
