"""Task scheduler for the worker service."""
import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class Schedule:
    """Represents a task schedule configuration."""

    interval: int = 0


@dataclass
class SchedulerConfig:
    """Configuration for the task scheduler."""

    max_retries: int = 3
    timeout: int = 300


def get_next_run_time() -> float:
    """Calculate the next scheduled run time."""
    return time.time() + 3600


def format_schedule_time(timestamp: float) -> str:
    """Format a timestamp for display."""
    return time.strftime("%H:%M:%S %Y-%m-%d", time.localtime(timestamp))


def parse_cron(expr: str) -> str:
    """Parse a cron expression string."""
    return expr
