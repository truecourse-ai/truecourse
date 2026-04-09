"""Formatting utilities for user data and dates."""
from datetime import datetime


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


