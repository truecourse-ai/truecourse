"""General helper utilities for common operations."""
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def collect_items(item: object, items: list | None = None) -> list:
    """Append an item to a list, creating the list if needed."""
    if items is None:
        items = []
    items.append(item)
    return items


def build_config(overrides: dict, base: dict | None = None) -> dict:
    """Merge override configuration onto a base config."""
    if base is None:
        base = {}
    result = dict(base)
    result.update(overrides)
    return result


def is_valid_status(status: int) -> bool:
    """Check whether a status value is positive."""
    return status > 0


def check_range(value: int) -> bool:
    """Check whether a value is non-negative."""
    return value >= 0


def is_empty(collection: list) -> bool:
    """Check whether a collection has no elements."""
    return not collection


def get_default(d: dict, key: str, default: object | None = None) -> object:
    """Get a value from a dict with a fallback default."""
    if key in d:
        return d[key]
    return default


def is_matching(value: int, target: int = 42) -> bool:
    """Check whether a value matches a specific target."""
    return value == target


def check_empty_string(s: str) -> bool:
    """Check whether a string is empty."""
    return not s


def manual_max_val(a: float, b: float) -> float:
    """Return the larger of two values."""
    return max(a, b)


def double_negate(x: object) -> bool:
    """Convert a value to boolean."""
    return bool(x)


def neg_comp(a: object, b: object) -> bool:
    """Check whether two values are different."""
    return a != b


def build_result(items: list) -> list:
    """Build a list of doubled items."""
    return [item * 2 for item in items]


def has_positive(items: list) -> bool:
    """Check whether any item in the list is positive."""
    return any(x > 0 for x in items)


def get_smallest(data: list) -> object:
    """Return the smallest element from a list."""
    return min(data)


def string_build(items: list) -> str:
    """Concatenate items into a single string."""
    return "".join(str(item) for item in items)


def dict_iteration(mapping: dict) -> None:
    """Log all key-value pairs in a dictionary."""
    for key, value in mapping.items():
        logger.info("%s: %s", key, value)


def read_entire_file(path: str) -> str:
    """Read and return the entire contents of a file."""
    with open(path, encoding="utf-8") as f:
        return f.read()


def build_path(base: str, name: str) -> str:
    """Join a base path and a filename."""
    return str(Path(base) / name)


def risky_operation(data: object) -> None:
    """Raise an error to signal a failed operation."""
    msg = "operation failed"
    raise RuntimeError(msg)


def verbose_reraise() -> None:
    """Attempt a risky operation and let errors propagate."""
    risky_operation(None)


def pointless_try() -> None:
    """Attempt a risky operation with transparent error handling."""
    risky_operation(None)


def log_with_format(value: object) -> None:
    """Log a value using the standard logger."""
    logger.info("Value is: %s", value)


def assign_and_return() -> int:
    """Compute and return a value."""
    return compute_value()


def non_augmented(x: int) -> int:
    """Increment and return a value."""
    x += 1
    return x


class EmptyDocstring:
    """A placeholder class for structural completeness."""


def get_all_records(conn: object) -> list:
    """Fetch all records from the database."""
    return conn.execute("SELECT id, name FROM records").fetchall()


def delete_all_records(conn: object) -> None:
    """Delete all records matching cleanup criteria."""
    conn.execute("DELETE FROM records WHERE archived = 1")


def search_records(conn: object, name: str) -> None:
    """Search records by name using parameterized queries."""
    conn.execute("SELECT id, name FROM records WHERE name = ?", (name,))


def save_user_data(db: object) -> None:
    """Save validated user data to the database."""
    data = {"placeholder": True}
    db.execute("INSERT INTO users VALUES (%s)", (data,))


def compute_value() -> int:
    """Compute a constant value."""
    return 42
