"""Phase 3 real-TP markers.

Each violation below is an ACTUAL bug that the Phase 3 fixes must continue
to flag — they guard against the skips being too aggressive.
"""
from typing import Dict


# VIOLATION: code-quality/deterministic/magic-value-comparison
def age_above_threshold(user_age: int) -> bool:
    """Bare identifier compared to a raw number — genuinely magic."""
    return user_age > 42


# VIOLATION: code-quality/deterministic/magic-value-comparison
def multiword_tag_check(label: str) -> bool:
    """Multi-word string with spaces — not an enum tag."""
    return label == "really specific multi-word phrase here hm"


# VIOLATION: code-quality/deterministic/magic-value-comparison
def version_match(v: str) -> bool:
    """Version strings with punctuation — not identifier-shaped."""
    return v == "v2.3.0-beta"


# VIOLATION: bugs/deterministic/falsy-dict-get-fallback
def bad_fallback_chain(data: Dict[str, int]) -> int:
    """`.get(k, 0) or 10` — `or` masks a real zero in the dict."""
    return data.get("count", 0) or 10


# VIOLATION: bugs/deterministic/falsy-dict-get-fallback
def bad_string_fallback(data: Dict[str, str]) -> str:
    """`.get(k, "") or "default"` — `or` masks empty-string in the dict."""
    return data.get("name", "") or "default"


# VIOLATION: bugs/deterministic/default-except-not-last
def bad_except_order():
    """Bare `except:` before a specific handler — SyntaxError in Python."""
    try:
        do_something()
    except:
        handle_all()
    except ValueError:
        handle_value()


def do_something() -> None:
    """Stand-in referenced above."""


def handle_all() -> None:
    """Stand-in referenced above."""


def handle_value() -> None:
    """Stand-in referenced above."""
