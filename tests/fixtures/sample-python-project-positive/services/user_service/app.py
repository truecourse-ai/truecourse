"""User service entry point and lifecycle management."""

import sqlite3
from logging import getLogger, INFO

DB_PATH = ":memory:"

_logger = getLogger(__name__)

_SCHEMA_SQL = (
    "CREATE TABLE IF NOT EXISTS users ("
    "id TEXT PRIMARY KEY, "
    "username TEXT UNIQUE NOT NULL, "
    "email TEXT UNIQUE NOT NULL, "
    "password_hash TEXT NOT NULL, "
    "created_at REAL NOT NULL"
    ")"
)


def initialize_database(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Create and initialize the SQLite database with the users table.

    Args:
        db_path: Path to the SQLite database file, or ':memory:'.

    Returns:
        An open database connection with the schema applied.
    """
    try:
        conn = sqlite3.connect(db_path)
    except sqlite3.Error:
        _logger.error("Failed to initialize database at %s", db_path)
        raise
    else:
        conn.row_factory = sqlite3.Row
        _apply_schema(conn)
        _logger.info("Database initialized at %s", db_path)
    return conn


def shutdown(conn: sqlite3.Connection) -> None:
    """Gracefully close the database connection.

    Args:
        conn: The database connection to close.
    """
    conn.close()
    _logger.info("Database connection closed")


def configure_logging(level: int = INFO) -> None:
    """Set the log level for the user service logger.

    Args:
        level: The desired logging level.
    """
    _logger.setLevel(level)
    for handler in _logger.handlers:
        handler.setLevel(level)


def _apply_schema(conn: sqlite3.Connection) -> None:
    """Apply the database schema, creating tables if they do not exist.

    Args:
        conn: The database connection to execute DDL on.
    """
    cursor = conn.cursor()
    cursor.execute(_SCHEMA_SQL)
    conn.commit()
    cursor.close()
