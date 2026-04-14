"""Data pipeline worker for processing and transforming datasets."""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass

logger = logging.getLogger(__name__)

HIGH_THRESHOLD = 100
MID_THRESHOLD = 50
LOW_THRESHOLD = 10
CATEGORY_A = "A"
CATEGORY_B = "B"
STATUS_READY = "ready"
FIELD_ID = "id"
FIELD_VALUE = "value"


@dataclass
class DataPoint:
    """A single data point for classification."""

    value: float = 0.0
    category: str = ""
    source: str = ""
    weight: float = 1.0
    active: bool = True
    priority: int = 0


def classify_data_point(point: DataPoint) -> str:
    """Classify a data point based on multiple dimensions."""
    if point.value > HIGH_THRESHOLD:
        suffixes = {CATEGORY_A: f"_{point.source}_a", CATEGORY_B: "_b"}
        suffix = suffixes.get(point.category, "_other")
        return f"high{suffix}"
    if point.value > MID_THRESHOLD:
        return "mid_active" if point.active else "mid_inactive"
    if point.value > LOW_THRESHOLD:
        return "low"
    return "minimal"


@dataclass
class Record:
    """A data record to be processed."""

    record_id: int = 0
    name: str = ""
    category: str = ""
    value: float = 0.0
    weight: float = 1.0
    source: str = ""
    priority: int = 0


def process_record(rec: Record) -> dict:
    """Process a single data record into a normalized dictionary."""
    return {
        "id": rec.record_id,
        "name": rec.name,
        "category": rec.category,
        "value": rec.value,
        "weight": rec.weight,
        "source": rec.source,
        "priority": rec.priority,
    }


def compute_statistics(records: list[float]) -> dict:
    """Compute basic descriptive statistics for a dataset."""
    n = len(records)
    if n == 0:
        return {"n": 0, "mean": 0, "median": 0}
    total = sum(records)
    mean = total / n
    sorted_data = sorted(records)
    median = sorted_data[n // 2]
    return {"n": n, "mean": mean, "median": median}


def _find_ready_subitem(record: dict) -> str | None:
    """Find the first ready subitem in a record."""
    for item in record.get("items") or []:
        if item.get("valid"):
            for sub in item.get("subitems") or []:
                if sub.get("status") == STATUS_READY:
                    return sub[FIELD_ID]
    return None


def deep_process(data_set: dict) -> str | None:
    """Recursively process nested data structures."""
    records = data_set.get("records") or []
    for record in records:
        if record.get("active"):
            result = _find_ready_subitem(record)
            if result is not None:
                return result
    return None


def _aggregate_item(
    item: dict,
    totals: dict[str, float],
    counts: dict[str, int],
    categories: set,
) -> None:
    """Aggregate a single validated item into running totals."""
    cat = item.get("category", "unknown")
    categories.add(cat)
    totals[cat] = totals[cat] + item[FIELD_VALUE]
    counts[cat] = counts[cat] + 1


def long_data_pipeline(raw: list[dict]) -> dict:
    """Run a complete data processing pipeline on raw input."""
    validated = [item for item in raw if FIELD_ID in item and FIELD_VALUE in item]
    totals: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    categories: set = set()
    for item in validated:
        _aggregate_item(item, totals, counts, categories)
    averages = {cat: totals[cat] / counts[cat] for cat in totals if counts[cat] > 0}
    logger.info("Pipeline complete: %d/%d valid", len(validated), len(raw))
    return {
        "total_records": len(raw),
        "valid_records": len(validated),
        "categories": list(categories),
        "totals": dict(totals),
        "averages": averages,
    }
