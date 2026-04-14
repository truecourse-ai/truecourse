"""Data processing module for transforming and analyzing datasets."""
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

HIGH_THRESHOLD = 100
MID_THRESHOLD = 50
LOW_THRESHOLD = 10


@dataclass
class DataInput:
    """Input data for classification."""

    value: float = 0.0
    category: str = ""
    source: str = ""
    weight: float = 1.0
    active: bool = True
    priority: int = 0


def classify_data_point(inp: DataInput) -> str:
    """Classify a data point based on value and category."""
    if inp.value > HIGH_THRESHOLD:
        return f"high_{inp.category.lower()}"
    if inp.value > MID_THRESHOLD:
        return "mid_active" if inp.active else "mid_inactive"
    if inp.value > LOW_THRESHOLD:
        return "low"
    return "minimal"


def compute_statistics(records: list[float]) -> dict:
    """Compute descriptive statistics for a dataset."""
    n = len(records)
    if n == 0:
        return {"n": 0}
    return {"n": n, "mean": sum(records) / n, "min": min(records), "max": max(records)}
