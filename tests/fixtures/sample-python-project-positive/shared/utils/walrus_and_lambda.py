"""Scope-analyzer Phase 3 coverage.

Exercises patterns the pre-Phase-3 scope analyzer got wrong:
  - Lambda parameters
  - Walrus operator bindings
  - Missing Python built-in exception types
  - Nested tuple unpacking in for loops

All references in this file must resolve cleanly. Zero undefined-name
violations expected.
"""


def sort_by_id(items: list[dict[str, int]]) -> list[dict[str, int]]:
    """Lambda parameter item must resolve inside the lambda body."""
    return sorted(items, key=lambda item: item.get("id", 0))


def find_largest(records: list[dict[str, int]]) -> dict[str, int]:
    """Walrus operator must bind row at the function scope."""
    if (row := max(records, key=lambda r: r.get("size", 0))):
        return row
    return {}


def label_pairs(rows: list[list[int]]) -> dict[int, int]:
    """Nested tuple unpacking in for loop. i, a, and b all bind."""
    out: dict[int, int] = {}
    for i, (a, b) in enumerate(rows):
        out[i] = a + b
    return out


def classify_error(error: BaseException) -> str:
    """Reference Python built-in exception types that were missing from
    PYTHON_GLOBALS before Phase 3. No raises are needed to exercise the
    scope lookup. the `isinstance` calls are enough."""
    if isinstance(error, KeyboardInterrupt):
        return "interrupt"
    if isinstance(error, SystemExit):
        return "exit"
    if isinstance(error, TimeoutError):
        return "timeout"
    if isinstance(error, ConnectionError):
        return "network"
    return "unknown"


# ---------------------------------------------------------------------------
# Walrus bound names consumed in the same expression. Walrus evaluates
# left-to-right; the bound name is in scope for the rest of the surrounding
# expression. undefined-local-variable should not flag any of these.
# ---------------------------------------------------------------------------


def fallback_class(data: dict, default: str) -> str:
    """Walrus inside a conditional expression — `c` is consumed by the
    surrounding ternary as soon as it is bound."""
    return c if (c := data.get("class_")) else default


def first_token(items: dict[str, list]) -> dict[str, str]:
    """Walrus inside a dict-comprehension's filter — `v` is consumed both
    in the filter clause and in the value position of the same expression."""
    return {
        key: v.upper()
        for key, value in items.items()
        if isinstance(v := value[0], str) and v.startswith("X")
    }


def first_matching_prefix(tokens: list[str], prefix: str) -> str | None:
    """Walrus in a while-loop condition — `token` is consumed in the body."""
    while (token := next(iter(tokens), None)) is not None:
        if token.startswith(prefix):
            return token
        tokens.pop(0)
    return None
