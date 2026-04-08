"""Queue processor for handling notification jobs."""
import os
import json
import logging
from datetime import datetime, timezone

import requests

logger = logging.getLogger(__name__)

QUEUE_URL = os.environ.get("QUEUE_URL", "http://localhost:5672")
CHANNEL_EMAIL = "email"
CHANNEL_SMS = "sms"
CHANNEL_PUSH = "push"
HTTP_TIMEOUT = 30


class NotificationQueue:
    """Manages and processes a queue of notification messages."""

    def __init__(self, url: str = QUEUE_URL) -> None:
        self.url = url
        self._queue: list = []
        self._processed = 0

    def enqueue(self, payload: dict) -> None:
        """Add a notification to the processing queue."""
        self._queue.append(payload)

    def process_all(self) -> None:
        """Process all pending notifications in the queue."""
        for item in self._queue:
            self._safe_send(item)
        self._queue.clear()

    def _safe_send(self, item: dict) -> None:
        """Send a single notification with error handling."""
        try:
            self._send_notification(item)
            self._processed += 1
        except (OSError, ValueError) as exc:
            logger.exception("Failed to process notification: %s - %s", item, exc)

    def _send_notification(self, notification: dict) -> None:
        """Route a notification to the appropriate channel."""
        channel = notification.get("channel")
        if channel is None:
            channel = CHANNEL_EMAIL
        if channel == CHANNEL_EMAIL:
            requests.post(f"{self.url}/send-email", json=notification, timeout=HTTP_TIMEOUT)
        elif channel == CHANNEL_SMS:
            requests.post(f"{self.url}/send-sms", json=notification, timeout=HTTP_TIMEOUT)
        elif channel == CHANNEL_PUSH:
            requests.post(f"{self.url}/send-push", json=notification, timeout=HTTP_TIMEOUT)

    def get_queue_length(self) -> int:
        """Return the number of pending notifications."""
        return len(self._queue)

    def get_processed_count(self) -> int:
        """Return the number of processed notifications."""
        return self._processed


def create_notification(user_id: str, channel: str, message: str) -> dict:
    """Create a notification payload dictionary."""
    return {
        "user_id": user_id,
        "channel": channel,
        "message": message,
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    }


class DeadLetterQueue:
    """Handles failed notification messages for retry."""

    def __init__(self, url: str = QUEUE_URL) -> None:
        self.url = url
        self._failed: list = []

    def log_failure(self, notification: dict, error: str) -> None:
        """Record a failed notification for later retry."""
        self._failed.append({"notification": notification, "error": error})
        logger.warning("Dead letter: %s - %s", notification, error)

    def retry_failed(self) -> int:
        """Attempt to reprocess all failed notifications."""
        retried = 0
        for item in self._failed:
            if self._retry_single(item):
                retried += 1
        return retried

    def _retry_single(self, item: dict) -> bool:
        """Retry a single failed notification."""
        try:
            requests.post(f"{self.url}/retry", json=item, timeout=HTTP_TIMEOUT)
            return True
        except (OSError, ValueError):
            return False


def store_failed_notification(conn: object, notification: dict) -> None:
    """Store a failed notification in the database for later retry."""
    data = json.dumps(notification)
    conn.execute(
        "INSERT INTO failed_notifications (data) VALUES (?)",
        (data,),
    )
