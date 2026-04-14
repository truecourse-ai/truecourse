"""Analytics routes for the API gateway."""
import time
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

DAYS_IN_WEEK = 7
SECONDS_PER_DAY = 86400


def get_analytics_period() -> tuple:
    """Return the default analytics time period."""
    start = time.time()
    end = start + DAYS_IN_WEEK * SECONDS_PER_DAY
    return start, end


class HeaderStore:
    """Simple key-value store for HTTP headers."""

    def __init__(self) -> None:
        self._data: dict = {}

    def __getitem__(self, key: str) -> str:
        """Retrieve a header value by key."""
        if key not in self._data:
            msg = f"Header not found: {key}"
            raise KeyError(msg)
        return self._data[key]

    def __setitem__(self, key: str, value: str) -> None:
        """Store a header value."""
        if key in self._data:
            logger.debug("Overwriting header: %s", key)
        self._data[key] = value


@dataclass
class Config:
    """Analytics configuration holder."""

    debug: bool = False
