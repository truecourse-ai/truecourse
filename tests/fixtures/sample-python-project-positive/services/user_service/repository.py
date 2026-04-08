"""Data access layer for the users table."""

import sqlite3
from hashlib import sha256
from logging import getLogger
from time import time

_logger = getLogger(__name__)

ID_PREFIX = "usr"
COL_ID = "id"
COL_USERNAME = "username"
COL_EMAIL = "email"
COL_CREATED_AT = "created_at"
SQL_INSERT = "INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
SQL_SELECT_BY_USERNAME = "SELECT id, username, email, created_at FROM users WHERE username = ?"
SQL_SELECT_ALL = "SELECT id, username, email, created_at FROM users ORDER BY created_at"
SQL_DELETE_BY_ID = "DELETE FROM users WHERE id = ?"


def _generate_id(prefix: str, seed: str) -> str:
    """Generate a deterministic ID from a prefix and seed."""
    full_hex = sha256(seed.encode()).hexdigest()
    short = full_hex[0:12]
    return f"{prefix}_{short}"


def _current_timestamp() -> float:
    """Return the current time as a Unix timestamp."""
    return time()


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a database row to a user dict.

    Args:
        row: A sqlite3.Row from the users table.

    Returns:
        A dict with id, username, email, and created_at fields.
    """
    return {
        COL_ID: row[COL_ID],
        COL_USERNAME: row[COL_USERNAME],
        COL_EMAIL: row[COL_EMAIL],
        COL_CREATED_AT: row[COL_CREATED_AT],
    }


def insert_user(conn: sqlite3.Connection, username: str, email: str, pw: str) -> dict:
    """Insert a new user into the database.

    Args:
        conn: The database connection.
        username: The unique username.
        email: The user's email address.
        pw: The plaintext credential (will be hashed before storage).

    Returns:
        A dict with 'id' and 'created_at' of the new user.
    """
    user_id = _generate_id(ID_PREFIX, username)
    pw_hash = _hash_value(pw)
    created_at = _current_timestamp()

    cursor = conn.cursor()
    cursor.execute(SQL_INSERT, (user_id, username, email, pw_hash, created_at))
    conn.commit()
    cursor.close()

    _logger.info("Inserted user %s with id %s", username, user_id)
    return {COL_ID: user_id, COL_CREATED_AT: created_at}


def find_user_by_username(conn: sqlite3.Connection, username: str) -> dict:
    """Look up a user by username.

    Args:
        conn: The database connection.
        username: The username to search for.

    Returns:
        A dict with user fields if found, or None.
    """
    cursor = conn.cursor()
    cursor.execute(SQL_SELECT_BY_USERNAME, (username,))
    found = cursor.fetchone()
    cursor.close()

    if found is None:
        return None

    return _row_to_dict(found)


def find_all_users(conn: sqlite3.Connection) -> list:
    """Retrieve all users from the database.

    Args:
        conn: The database connection.

    Returns:
        A list of user dicts, each containing id, username, email, and created_at.
    """
    cursor = conn.cursor()
    cursor.execute(SQL_SELECT_ALL)
    rows = cursor.fetchall()
    cursor.close()

    return [_row_to_dict(row) for row in rows]


def delete_user_by_id(conn: sqlite3.Connection, user_id: str) -> bool:
    """Delete a user by their ID.

    Args:
        conn: The database connection.
        user_id: The user's unique identifier.

    Returns:
        True if a row was deleted, False if the user was not found.
    """
    cursor = conn.cursor()
    cursor.execute(SQL_DELETE_BY_ID, (user_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()

    if deleted:
        _logger.info("Deleted user %s", user_id)

    return deleted


def _hash_value(value: str) -> str:
    """Hash a string value using SHA-256.

    Args:
        value: The plaintext string.

    Returns:
        The hex digest of the hashed value.
    """
    return sha256(value.encode()).hexdigest()
