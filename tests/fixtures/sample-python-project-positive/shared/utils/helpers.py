"""General helper utilities for common operations."""
import os
import logging
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# Module-level mutable cache, explicitly guarded by a colocated lock. The
# `shared-mutable-module-state` detector must recognise that the writer has
# already considered concurrency when a `threading.Lock` (or `RLock`) is
# declared in the same module - suppressing the FP without requiring the
# state to be hoisted into a request handler.
_cache_lock = threading.Lock()
_request_cache: dict = {}
_recent_keys: list = []


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


# Variadic-arg signatures with explicit type annotations. The argument-type-
# mismatch detector must treat `**kwargs: Any` and `*keys: str` as varargs
# (not as required positional params) when it sees them as `typed_parameter`
# nodes in tree-sitter.

def emit_event(level: str, event: str, **kwargs: object) -> None:
    """Emit a structured log event with arbitrary metadata."""
    logger.info("%s %s %s", level, event, kwargs)


def join_keys(prefix: str, *keys: str) -> str:
    """Join keys with a prefix using positional varargs."""
    return prefix + ":" + "/".join(keys)


SQL_PATTERNS = [
    # Multi-line implicit string concatenation inside a list - the canonical
    # Python idiom for splitting a long string across lines. The
    # implicit-string-concatenation detector must not flag this; it should
    # only fire on same-line adjacency like `"foo" "bar"` which is more
    # likely a missing-comma bug.
    "SELECT id, name, email "
    "FROM users "
    "WHERE active = 1 AND deleted_at IS NULL "
    "ORDER BY created_at DESC",
    "SELECT id, total "
    "FROM orders "
    "WHERE status = 'pending'",
]


def fetch_all(urls: list[str], fetcher: object) -> list[str]:
    """Fetch each URL, skipping ones that time out.

    `except TimeoutError: continue` is the canonical Python idiom for
    "on this specific recoverable error, drop the item and move on."
    The try-except-continue detector should only fire on bare except /
    `Exception` / `BaseException` catches that swallow all errors silently;
    a typed exception is an explicit, narrow suppression and is fine.
    """
    results: list[str] = []
    for url in urls:
        try:
            results.append(fetcher.fetch(url))
        except TimeoutError:
            continue
    return results


def call_variadic_helpers() -> None:
    """Call helpers with extra positional and keyword arguments."""
    emit_event("INFO", "boot", request_id="abc-123", trace_id="xyz")
    emit_event("WARN", "retry", attempt=2)
    join_keys("user", "id", "name", "email")
    join_keys("session", "token")


def run_with_closure() -> int:
    """Closure resolves a captured variable defined later in the enclosing scope.

    Python resolves free variables in nested functions at CALL time, not at
    DEF time. `request_id` is referenced inside `inner()` before the textual
    assignment, but `inner()` is not called until after the assignment has
    run, so no NameError occurs. The undefined-local-variable detector must
    not flag this pattern.
    """
    def inner() -> str:
        """Format the captured request id for logging."""
        return f"trace={request_id}"

    request_id = "req-42"
    return len(inner())


class _AnnotatedAxes:
    """Minimal stand-in for a matplotlib axes object."""

    def __init__(self) -> None:
        self._width = 1.0
        self._y = 0.0
        self._labels: list[str] = []

    def text(self, x: float, y: float, label: str) -> None:
        """Render an annotation at (x, y)."""
        self._labels.append(f"{x},{y}:{label}")

    def get_width(self) -> float:
        """Return the bar width."""
        return self._width

    def get_y(self) -> float:
        """Return the y-baseline."""
        return self._y


def annotate_chart(values: list[int], series: str) -> None:
    """Annotate a chart with a computed label using matplotlib-style coords.

    `ax.text(...)` is the matplotlib annotation API, not a SQL call. The
    first positional argument is an arithmetic x-coordinate expression
    (`bar.get_width() + offset`) which the sql-injection detector mis-fires
    on because it sees a binary `+` operator. There is no SQL anywhere
    here - the rule must not fire.
    """
    bar = _AnnotatedAxes()
    ax = _AnnotatedAxes()
    offset = max(values) * 0.02
    ax.text(bar.get_width() + offset, bar.get_y() + 0.5, f"Total: {sum(values)} ({series})")
