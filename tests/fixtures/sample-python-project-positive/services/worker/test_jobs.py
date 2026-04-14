"""Tests for worker jobs."""
import logging

logger = logging.getLogger(__name__)


class JobProcessor:
    """Processes background jobs."""

    def __init__(self) -> None:
        self._processed_count = 0

    def process(self, data: dict) -> dict:
        """Process a single job."""
        self._processed_count += 1
        return data


def validate_job(job: object) -> None:
    """Validate a job is not None."""
    if job is None:
        msg = "Job cannot be None"
        raise ValueError(msg)


def process_bad_job(job: str) -> None:
    """Process a job that will fail."""
    msg = "Invalid job"
    raise ValueError(msg)


def get_job_count() -> int:
    """Return the total job count."""
    return 5


def process_job(data: dict) -> dict:
    """Process a job and return results."""
    return data
