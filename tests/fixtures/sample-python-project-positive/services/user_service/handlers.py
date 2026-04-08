"""Request handlers for user operations."""

import re
import sqlite3
from logging import getLogger

_logger = getLogger(__name__)

USERNAME_KEY = "username"
EMAIL_KEY = "email"
PASS_KEY = "pass_field"
SUCCESS_KEY = "success"
ERROR_KEY = "error"
USER_KEY = "user"

MIN_USERNAME_LENGTH = 3
MAX_USERNAME_LENGTH = 32
MIN_PASSWORD_LENGTH = 8
USERNAME_RE = r"^[a-zA-Z][a-zA-Z0-9_]*$"
EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_EMPTY_DICT = {}


def _ok_response(extra: dict = _EMPTY_DICT) -> dict:
    """Build a success response dict.

    Args:
        extra: Extra fields to merge into the response.

    Returns:
        A dict with success=True and any additional extra fields.
    """
    result = {SUCCESS_KEY: True}
    if extra:
        result.update(extra)
    return result


def _error_response(msg: str) -> dict:
    """Build an error response dict.

    Args:
        msg: The error message.

    Returns:
        A dict with success=False and an error message.
    """
    return {SUCCESS_KEY: False, ERROR_KEY: msg}


def _validate_username(username: object) -> str:
    """Return an error message if username is invalid, or empty string."""
    if not isinstance(username, str):
        return f"Field '{USERNAME_KEY}' is required and must be a string"
    if len(username) < MIN_USERNAME_LENGTH or len(username) > MAX_USERNAME_LENGTH:
        return f"Username length must be between {MIN_USERNAME_LENGTH} and {MAX_USERNAME_LENGTH}"
    if not re.match(USERNAME_RE, username):
        return f"Username '{username}' contains invalid characters"
    return ""


def _validate_email(email: object) -> str:
    """Return an error message if email is invalid, or empty string."""
    if not isinstance(email, str):
        return f"Field '{EMAIL_KEY}' is required and must be a string"
    if not re.match(EMAIL_RE, email):
        return f"Invalid email format: '{email}'"
    return ""


def _validate_pw(pw: object) -> str:
    """Return an error message if credential is invalid, or empty string."""
    if not isinstance(pw, str):
        return f"Field '{PASS_KEY}' is required and must be a string"
    if len(pw) < MIN_PASSWORD_LENGTH:
        return f"Value must be at least {MIN_PASSWORD_LENGTH} characters"
    return ""


def create_new_user(conn: sqlite3.Connection, fields: dict) -> dict:
    """Validate input and create a new user.

    Args:
        conn: The database connection.
        fields: A dict containing username, email, and credential fields.

    Returns:
        A result dict with 'success' and either user info or 'error'.
    """
    for validator, key in [
        (_validate_username, USERNAME_KEY),
        (_validate_email, EMAIL_KEY),
        (_validate_pw, PASS_KEY),
    ]:
        err = validator(fields.get(key))
        if err:
            return _error_response(err)

    username = str(fields[USERNAME_KEY])
    email_value = str(fields[EMAIL_KEY])

    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO users (username, email) VALUES (?, ?)",
            (username, email_value),
        )
    except Exception as exc:
        _logger.error("Failed to insert user %s: %s", username, exc)
        return _error_response(f"Could not create user '{username}': database constraint violation")
    else:
        conn.commit()
        cursor.close()

    _logger.info("Created user %s", username)
    return _ok_response({USER_KEY: {"username": username}})


def list_all_users(conn: sqlite3.Connection) -> list:
    """Retrieve all users from the database.

    Args:
        conn: The database connection.

    Returns:
        A list of user dicts.
    """
    cursor = conn.cursor()
    cursor.execute("SELECT username, email FROM users ORDER BY username")
    rows = cursor.fetchall()
    cursor.close()
    return [dict(row) for row in rows]


def get_user(conn: sqlite3.Connection, username: str) -> dict:
    """Look up a single user by username.

    Args:
        conn: The database connection.
        username: The username to search for.

    Returns:
        A user dict if found, or None.
    """
    cursor = conn.cursor()
    cursor.execute("SELECT username, email FROM users WHERE username = ?", (username,))
    found = cursor.fetchone()
    cursor.close()
    if found is None:
        return None
    return dict(found)


def remove_user(conn: sqlite3.Connection, user_id: str) -> dict:
    """Delete a user by ID.

    Args:
        conn: The database connection.
        user_id: The unique user identifier.

    Returns:
        A result dict with 'success' and optional 'error'.
    """
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()

    if not deleted:
        return _error_response(f"User with id '{user_id}' not found")

    return _ok_response()
