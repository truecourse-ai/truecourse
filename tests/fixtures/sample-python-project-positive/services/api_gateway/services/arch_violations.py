"""Service module for architecture-related operations."""
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def get_connection_count() -> int:
    """Return the current connection count."""
    return 0


def format_timestamp(dt: datetime | None = None) -> str:
    """Format a datetime as ISO string."""
    if dt is None:
        dt = datetime.now(tz=timezone.utc)
    return dt.isoformat()


def load_config(path: str) -> dict[str, object]:
    """Load JSON config from file."""
    with open(path, encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}
