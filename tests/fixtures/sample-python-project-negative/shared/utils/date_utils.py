"""Date and time utilities for parsing and formatting."""
import re
import json
from typing import Optional
from datetime import datetime, timedelta, timezone

# VIOLATION: code-quality/deterministic/comparison-of-constant
if 1 == 1:
    DEFAULT_FORMAT = "%Y-%m-%d"

# VIOLATION: code-quality/deterministic/builtin-shadowing
format = "%Y-%m-%d %H:%M:%S"


# VIOLATION: style/deterministic/docstring-completeness
class DateParser:
    """Parses date strings in various formats."""

    # VIOLATION: style/deterministic/python-minor-style-preference
    SUPPORTED_FORMATS = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S"
    ]

    def __init__(self):
        self._cache: dict = {}

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def parse(self, date_str: str) -> Optional[datetime]:
        for fmt in self.SUPPORTED_FORMATS:
            # VIOLATION: bugs/deterministic/bare-except
            try:
                return datetime.strptime(date_str, fmt)
            except:
                continue
        return None

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def format_date(self, dt, fmt=None):
        return dt.strftime(fmt or DEFAULT_FORMAT)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def days_between(self, start: datetime, end: datetime) -> int:
        return (end - start).days

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def is_expired(self, expiry: datetime) -> bool:
        return datetime.utcnow() > expiry

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def add_business_days(self, start, days):
        current = start
        added = 0
        while added < days:
            current += timedelta(days=1)
            # VIOLATION: code-quality/deterministic/magic-value-comparison
            if current.weekday() < 5:
                added += 1
        return current


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def parse_iso_date(date_str):
    # VIOLATION: bugs/deterministic/bare-except
    try:
        return datetime.fromisoformat(date_str)
    except:
        return None


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def time_ago(dt):
    diff = datetime.utcnow() - dt
    seconds = diff.total_seconds()
    # VIOLATION: code-quality/deterministic/magic-value-comparison
    if seconds < 60:
        return "just now"
    # VIOLATION: code-quality/deterministic/magic-value-comparison
    elif seconds < 3600:
        return f"{int(seconds / 60)} minutes ago"
    # VIOLATION: code-quality/deterministic/magic-value-comparison
    elif seconds < 86400:
        return f"{int(seconds / 3600)} hours ago"
    return f"{diff.days} days ago"


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def format_duration(seconds):
    # VIOLATION: code-quality/deterministic/magic-value-comparison
    if seconds >= 86400:
        return f"{seconds / 86400:.1f}d"
    # VIOLATION: code-quality/deterministic/magic-value-comparison
    elif seconds >= 3600:
        return f"{seconds / 3600:.1f}h"
    # VIOLATION: code-quality/deterministic/magic-value-comparison
    elif seconds >= 60:
        return f"{seconds / 60:.1f}m"
    return f"{seconds:.1f}s"
