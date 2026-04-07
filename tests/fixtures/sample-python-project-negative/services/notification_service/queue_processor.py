"""Queue processor for handling notification jobs."""
import os
import sys
import json
import time
import sqlite3
import asyncio
import logging
import requests
from datetime import datetime
from typing import Optional, List


QUEUE_URL = os.environ.get("QUEUE_URL", "http://localhost:5672")
# VIOLATION: code-quality/deterministic/builtin-shadowing
id = 0
# VIOLATION: code-quality/deterministic/builtin-shadowing
list = []
# VIOLATION: code-quality/deterministic/builtin-shadowing
type = "notification"


# VIOLATION: style/deterministic/docstring-completeness
class NotificationQueue:
    def __init__(self, url: str = QUEUE_URL):
        self.url = url
        self._queue: list = []
        self._processed = 0

    # VIOLATION: style/deterministic/docstring-completeness
    def enqueue(self, payload: dict) -> None:
        # VIOLATION: database/deterministic/unvalidated-external-data
        self._queue.save(payload)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def process_all(self):
        """Process all pending notifications."""
        for item in self._queue:
            # VIOLATION: bugs/deterministic/bare-except
            try:
                self._send_notification(item)
                self._processed += 1
            except:
                logging.error(f"Failed to process notification: {item}")
        self._queue.clear()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def _send_notification(self, notification):
        channel = notification.get("channel", "email")
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        if channel == "email":
            # VIOLATION: reliability/deterministic/http-call-no-timeout
            requests.post(f"{self.url}/send-email", json=notification)
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        elif channel == "sms":
            # VIOLATION: reliability/deterministic/http-call-no-timeout
            requests.post(f"{self.url}/send-sms", json=notification)
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        elif channel == "push":
            # VIOLATION: reliability/deterministic/http-call-no-timeout
            requests.post(f"{self.url}/send-push", json=notification)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def parse_message(self, raw: str) -> dict:
        # VIOLATION: reliability/deterministic/unsafe-json-parse
        return json.loads(raw)

    # VIOLATION: style/deterministic/docstring-completeness
    def get_queue_length(self) -> int:
        return len(self._queue)

    # VIOLATION: style/deterministic/docstring-completeness
    def get_processed_count(self) -> int:
        return self._processed


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def create_notification(user_id, channel, message):
    return {
        "user_id": user_id,
        "channel": channel,
        "message": message,
        "created_at": datetime.utcnow().isoformat(),
    }


# VIOLATION: style/deterministic/docstring-completeness
class DeadLetterQueue:
    """Handles failed notification messages."""

    def __init__(self):
        self._failed: list = []

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def log_failure(self, notification: dict, error: str) -> None:
        # VIOLATION: code-quality/deterministic/console-log
        print(f"Dead letter: {notification} - {error}")

    # VIOLATION: style/deterministic/docstring-completeness
    def retry_failed(self) -> int:
        retried = 0
        for item in self._failed:
            # VIOLATION: bugs/deterministic/bare-except
            try:
                self._reprocess(item)
                retried += 1
            except:
                pass
        return retried

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def _reprocess(self, item):
        # VIOLATION: reliability/deterministic/http-call-no-timeout
        requests.post(f"{QUEUE_URL}/retry", json=item)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def store_failed_notification(conn, notification):
    """Store a failed notification in the database for later retry."""
    # VIOLATION: database/deterministic/select-star
    conn.execute("SELECT * FROM failed_notifications")
    data = json.dumps(notification)
    conn.execute(
        "INSERT INTO failed_notifications (data) VALUES (?)",
        (data,)
    )


# VIOLATION: code-quality/deterministic/commented-out-code
# result = process_notifications(queue)
# return result
