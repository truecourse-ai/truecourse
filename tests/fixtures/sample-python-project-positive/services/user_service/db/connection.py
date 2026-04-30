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


def _open_postgres():
    """Connection factory: callers are responsible for releasing.

    The `connection-not-released` rule must not fire on factory functions
    that return a freshly-opened connection - the resource ownership is
    transferred to the caller, who handles the lifecycle.
    """
    return sqlite3.connect(DATABASE_URL)


def count_active_users() -> int:
    """Acquire a connection, run a query, release it on every exit path.

    The `try/finally: conn.close()` idiom is the canonical way to release
    a connection when a `with` block isn't appropriate (e.g. the cursor
    is the context-managed object). The detector must recognise this
    flow even though `sqlite3.connect()` is outside the try body.
    """
    conn = sqlite3.connect(DATABASE_URL)
    try:
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM users WHERE active = 1")
        row = cur.fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


# Lambda warm-start cache - module-level connection reused across invocations
# of the same container. The connection is owned by the runtime, not by any
# single function, so the rule shouldn't fire on the assignment.
_DB_CONN: sqlite3.Connection = sqlite3.connect(DATABASE_URL)


class _CleanupScript:
    """Long-lived cleanup-script object that holds its connection for the
    entire run via `self.conn`. The rule shouldn't fire on attribute
    assignment patterns - the connection's lifetime is the object's
    lifetime, which is well-scoped.
    """

    def __init__(self, db_path: str) -> None:
        self.conn = sqlite3.connect(db_path)

    def cleanup(self) -> None:
        """Run the cleanup query against the held connection."""
        cur = self.conn.cursor()
        cur.execute("DELETE FROM stale_rows WHERE archived = 1")


def _replace_attachments(cur: object, attachment_id: int, payload: dict) -> None:
    """Private helper that takes a caller-supplied cursor.

    The leading-underscore convention plus the cursor parameter signal
    that callers in this module manage the scope. The detector should
    not flag write counts inside such helpers - the public callers
    are where the lifecycle ownership question lands.
    """
    cur.execute("DELETE FROM attachments WHERE id = %s", (attachment_id,))
    cur.execute("INSERT INTO attachments (id, data) VALUES (%s, %s)", (attachment_id, payload["data"]))


def watermark_summary(cur: object, lower_bound: int = 0) -> tuple[int, int]:
    """Read-only summary over an events table whose timestamp columns are
    named `updated_at` and `created_at`.

    Both branches issue pure SELECT queries. The write-detection regex
    `/insert|update|delete|.../` must be word-bounded - otherwise
    `update` matches inside `updated_at` and the if/else-of-SELECTs
    pattern fires a false `Multiple writes without...` violation.
    """
    if lower_bound == 0:
        cur.execute("SELECT COUNT(*), MAX(updated_at) FROM events WHERE updated_at <= %s", (0,))
    else:
        cur.execute("SELECT COUNT(*), MAX(updated_at) FROM events WHERE updated_at <= %s AND created_at >= %s", (0, lower_bound))
    row = cur.fetchone() or (0, 0)
    return int(row[0]), int(row[1] or 0)
