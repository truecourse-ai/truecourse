"""Notification model for user notifications."""
import logging

logger = logging.getLogger(__name__)


class NotificationModel:
    """Represents a notification sent to a user."""

    def __init__(self, user_id: str, message: str, channel: str = "email") -> None:
        self.user_id = user_id
        self.message = message
        self.channel = channel
        self.delivered = False

    def mark_delivered(self) -> None:
        """Mark this notification as delivered."""
        self.delivered = True
