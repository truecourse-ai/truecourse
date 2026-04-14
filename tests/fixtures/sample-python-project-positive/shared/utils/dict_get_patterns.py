"""falsy-dict-get-fallback Phase 3 coverage.

Bare dict.get(key, falsy_default) is idiomatic Python. The rule should
only flag the d.get(k, falsy) or fallback chained-or anti-pattern.

Zero violations expected.
"""


def extract_counts(data: dict[str, int]) -> int:
    """Bare get with int default is idiomatic, no violation."""
    return data.get("count", 0)


def extract_items(data: dict[str, list[int]]) -> list[int]:
    """Bare get with list default is idiomatic, no violation."""
    return data.get("items", [])


def extract_name(data: dict[str, str]) -> str:
    """Bare get with string default is idiomatic, no violation."""
    return data.get("name", "")


def extract_nested(data: dict[str, dict[str, str]]) -> dict[str, str]:
    """Bare get with dict default used in nested access, no violation."""
    inner = data.get("inner", {})
    return inner.get("payload", {})


def increment_counter(counters: dict[str, int], name: str) -> None:
    """Arithmetic with get uses plus operator, not or fallback, no violation."""
    counters[name] = counters.get(name, 0) + 1
