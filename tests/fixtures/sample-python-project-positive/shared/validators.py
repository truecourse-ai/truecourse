"""Input validation helpers."""

import re

MIN_USERNAME_LENGTH = 3
MAX_USERNAME_LENGTH = 32
MIN_PASSWORD_LENGTH = 8
USERNAME_PATTERN = r"^[a-zA-Z][a-zA-Z0-9_]*$"
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def validate_username(username: str) -> tuple:
    """Validate a username against length and character rules.

    Args:
        username: The username string to validate.

    Returns:
        A tuple of (is_valid, error_message). Error message is empty if valid.
    """
    if len(username) < MIN_USERNAME_LENGTH:
        msg = f"Username must be at least {MIN_USERNAME_LENGTH} characters, got {len(username)}"
        return False, msg

    if len(username) > MAX_USERNAME_LENGTH:
        msg = f"Username must be at most {MAX_USERNAME_LENGTH} characters, got {len(username)}"
        return False, msg

    if not re.match(USERNAME_PATTERN, username):
        msg = f"Username '{username}' contains invalid characters"
        return False, msg

    return True, ""


def validate_email(email: str) -> tuple:
    """Validate an email address format.

    Args:
        email: The email string to validate.

    Returns:
        A tuple of (is_valid, error_message). Error message is empty if valid.
    """
    if not re.match(EMAIL_PATTERN, email):
        msg = f"Invalid email format: '{email}'"
        return False, msg

    return True, ""


def validate_password(pw: str) -> tuple:
    """Validate a credential meets minimum strength requirements.

    Args:
        pw: The credential string to validate.

    Returns:
        A tuple of (is_valid, error_message). Error message is empty if valid.
    """
    if len(pw) < MIN_PASSWORD_LENGTH:
        msg = f"Value must be at least {MIN_PASSWORD_LENGTH} characters, got {len(pw)}"
        return False, msg

    has_upper = False
    has_lower = False
    has_digit = False
    for ch in pw:
        if ch.isupper():
            has_upper = True
        elif ch.islower():
            has_lower = True
        elif ch.isdigit():
            has_digit = True

    if not (has_upper and has_lower and has_digit):
        msg = "Must contain uppercase, lowercase, and digit characters"
        return False, msg

    return True, ""


def sanitize_string(value: str, max_length: int = MAX_USERNAME_LENGTH) -> str:
    """Strip and truncate a string to a maximum length.

    Args:
        value: The input string.
        max_length: Maximum allowed length after truncation.

    Returns:
        The sanitized string.
    """
    cleaned = value.strip()
    if len(cleaned) > max_length:
        cleaned = cleaned[0:max_length]
    return cleaned
