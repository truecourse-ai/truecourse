"""Date and time utilities for parsing and formatting."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

DEFAULT_FORMAT = "%Y-%m-%d"
SECONDS_PER_MINUTE = 60
SECONDS_PER_HOUR = 3600
SECONDS_PER_DAY = 86400
WEEKDAYS = 5


class DateParser:
    """Parses date strings in various formats."""

    SUPPORTED_FORMATS = (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    )

    def __init__(self) -> None:
        self._cache: dict[str, datetime | None] = {}

    def parse(self, date_str: str) -> datetime | None:
        """Parse a date string trying multiple formats."""
        if date_str in self._cache:
            return self._cache[date_str]
        result = self._try_parse(date_str)
        self._cache[date_str] = result
        return result

    def _try_parse(self, date_str: str) -> datetime | None:
        """Try parsing with each supported format."""
        for fmt in self.SUPPORTED_FORMATS:
            result = self._safe_strptime(date_str, fmt)
            if result is not None:
                return result
        return None

    def _safe_strptime(self, date_str: str, fmt: str) -> datetime | None:
        """Parse a date string with a single format, returning None on failure."""
        try:
            result = datetime.strptime(date_str, fmt)
            self._cache[date_str] = result
            return result
        except ValueError:
            return None

    def format_date(self, dt: datetime, fmt: str | None = None) -> str:
        """Format a datetime using the given or default format."""
        self._cache.clear()
        return dt.strftime(fmt or DEFAULT_FORMAT)

    def days_between(self, start: datetime, end: datetime) -> int:
        """Calculate the number of days between two dates."""
        self._cache.clear()
        return (end - start).days

    def is_expired(self, expiry: datetime) -> bool:
        """Check whether the given expiry datetime has passed."""
        self._cache.clear()
        return datetime.now(tz=timezone.utc) > expiry

    def add_business_days(self, start: datetime, days: int) -> datetime:
        """Add the specified number of business days to a date."""
        self._cache.clear()
        current = start
        added = 0
        while added < days:
            current += timedelta(days=1)
            if current.weekday() < WEEKDAYS:
                added += 1
        return current


def parse_iso_date(date_str: str) -> datetime | None:
    """Parse an ISO 8601 date string."""
    try:
        return datetime.fromisoformat(date_str)
    except ValueError:
        return None


def time_ago(dt: datetime) -> str:
    """Return a human-readable time-ago string."""
    diff = datetime.utcnow() - dt
    seconds = diff.total_seconds()
    if seconds < SECONDS_PER_MINUTE:
        return "just now"
    elif seconds < SECONDS_PER_HOUR:
        minutes = int(seconds / SECONDS_PER_MINUTE)
        return f"{minutes} minutes ago"
    elif seconds < SECONDS_PER_DAY:
        hours = int(seconds / SECONDS_PER_HOUR)
        return f"{hours} hours ago"
    return f"{diff.days} days ago"


def format_duration(seconds: float) -> str:
    """Format a duration in seconds as a human-readable string."""
    if seconds >= SECONDS_PER_DAY:
        return f"{seconds / SECONDS_PER_DAY:.1f}d"
    elif seconds >= SECONDS_PER_HOUR:
        return f"{seconds / SECONDS_PER_HOUR:.1f}h"
    elif seconds >= SECONDS_PER_MINUTE:
        return f"{seconds / SECONDS_PER_MINUTE:.1f}m"
    return f"{seconds:.1f}s"
