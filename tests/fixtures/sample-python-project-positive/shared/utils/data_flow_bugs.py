"""Data flow utilities for processing and transforming data."""
import logging

logger = logging.getLogger(__name__)


def process_data(items: list) -> list:
    """Process items and collect results into a list."""
    return [item for item in items]


def transform_data(data: list) -> list:
    """Apply a simple transformation to each data element."""
    return [item for item in data]


def compute_stats(values: list) -> float:
    """Compute the running total of a list of values."""
    running_sum = 0
    for v in values:
        running_sum += v
    return running_sum
