"""Input validation utilities."""
import re

MIN_NAME_LENGTH = 2
MAX_NAME_LENGTH = 100


def validate_email(email: str) -> bool:
    """Validate an email address format using a simple regex."""
    email_regex = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    return bool(re.match(email_regex, email))


def validate_name(name: str) -> bool:
    """Validate a name meets length requirements."""
    name_len = len(name)
    return name_len >= MIN_NAME_LENGTH and name_len <= MAX_NAME_LENGTH
