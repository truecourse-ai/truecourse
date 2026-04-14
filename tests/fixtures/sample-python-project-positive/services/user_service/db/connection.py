"""Database connection management for the user service."""
import os
import sqlite3
import logging

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///users.db")


def get_connection() -> sqlite3.Connection:
    """Get a database connection from the configured URL."""
    try:
        conn = sqlite3.connect(DATABASE_URL)
    except sqlite3.Error:
        logger.exception("Failed to connect to database")
        raise
    return conn
