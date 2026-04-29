"""Database connection management for the user service."""
import os
import sqlite3
import logging
from urllib.parse import quote_plus

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


def build_postgres_url() -> str:
    """Build a Postgres DSN from environment variables.

    The credentials are loaded from `os.getenv` and interpolated into an
    f-string. This is the standard idiomatic pattern - it must not trip the
    `hardcoded-database-password` detector because the password segment is
    a Python f-string interpolation, not a literal.
    """
    user = os.getenv("USER_DB_USER", "")
    password = os.getenv("USER_DB_PASSWORD", "")
    host = os.getenv("USER_DB_HOST", "localhost")
    port = os.getenv("USER_DB_PORT", "5432")
    db_name = os.getenv("USER_DB_NAME", "users")
    sslmode = os.getenv("USER_DB_SSLMODE", "require")
    return f"postgres://{user}:{quote_plus(password)}@{host}:{port}/{db_name}?sslmode={sslmode}"


def build_mysql_url(user: str, password: str, host: str, db: str) -> str:
    """Build a MySQL DSN from explicit credential parameters.

    The password is a function parameter, not a literal - also must not trip
    the detector.
    """
    return f"mysql://{user}:{password}@{host}:3306/{db}"


def init_local_db() -> None:
    """Initialise the sqlite store on first run.

    Idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
    DDL is the standard sqlite bootstrap pattern. It runs every startup
    safely and IS the migration mechanism for embedded sqlite stores -
    `missing-migration` must not flag it.
    """
    with get_connection() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, rating INTEGER, note TEXT)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating)")
