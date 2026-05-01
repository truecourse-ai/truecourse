"""Formatting utilities for user data and dates."""
from collections import Counter
from datetime import datetime
from typing import Iterable


def format_user(user: dict) -> dict:
    """Format a raw user record into the standard display format."""
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "displayName": f"{user['name']} <{user['email']}>",
        "createdAt": datetime.fromisoformat(str(user["createdAt"])).isoformat(),
    }


def format_date(date: datetime) -> str:
    """Format a datetime to ISO date string (YYYY-MM-DD)."""
    return date.isoformat().split("T", maxsplit=1)[0]


# Allow invitation validation without auth (accept still requires auth)
# This function handles both cases (success and failure)
# Returns the processed result (or null if not found)
def clean_comment_example() -> str:
    """Ensure natural-language comments with parentheses are not flagged."""
    return "no false positives"


def aggregate_attribute_pairs(rows: Iterable[tuple[str, str]]) -> dict[str, int]:
    """Count co-occurring attribute pairs and key by their concatenation.

    The dict comprehension's key is an f-string interpolating loop
    variables — every iteration produces a unique key. The
    static-key-dict-comprehension and duplicate-dict-key rules should
    not flag this.
    """
    counter: Counter[tuple[str, str]] = Counter()
    for attribute_type, attribute_value in rows:
        counter[(attribute_type, attribute_value)] += 1
    return {
        f"{attribute_type}:{attribute_value}": count
        for (attribute_type, attribute_value), count in counter.items()
        if count >= 2
    }


