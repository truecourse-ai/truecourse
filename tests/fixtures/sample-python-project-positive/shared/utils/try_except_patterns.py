"""default-except-not-last Phase 3 coverage.

All handlers use specific exception types with as e bindings. None are
bare except clauses, so the rule must not fire on any of these chains.

Zero violations expected.
"""


class HTTPStatusError(Exception):
    """Dummy stand-in for httpx.HTTPStatusError used in fixture."""


class RequestError(Exception):
    """Dummy stand-in for httpx.RequestError used in fixture."""


def classify_error(err: Exception) -> str:
    """Specific except-as chain with HTTPStatusError then RequestError."""
    try:
        if isinstance(err, HTTPStatusError):
            raise err
        if isinstance(err, RequestError):
            raise err
        return "ok"
    except HTTPStatusError as http_err:
        return f"http: {http_err}"
    except RequestError as req_err:
        return f"request: {req_err}"


def handle_grouped_error(err: Exception) -> str:
    """Parenthesized tuple with as pattern: except (A, B) as e."""
    try:
        if isinstance(err, (HTTPStatusError, RequestError)):
            raise err
        return "ok"
    except (HTTPStatusError, RequestError) as grouped:
        return f"group: {grouped}"
    except ValueError as v_err:
        return f"value: {v_err}"
