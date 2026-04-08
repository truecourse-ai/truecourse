"""Middleware functions for authentication and request logging."""

from hashlib import sha256
from logging import getLogger
from time import time

_logger = getLogger(__name__)

AUTH_HEADER = "Authorization"
BEARER_PREFIX = "Bearer "
TOKEN_HASH_LENGTH = 16


def authenticate_request(headers: dict[str, str]) -> tuple[bool, str]:
    """Validate the Authorization header from a request.

    Args:
        headers: A dictionary of HTTP header name-value pairs.

    Returns:
        A tuple of (is_authenticated, user_id_or_error).
    """
    auth_value = headers.get(AUTH_HEADER)
    if auth_value is None:
        msg = f"Missing {AUTH_HEADER} header in request"
        return False, msg

    if not auth_value.startswith(BEARER_PREFIX):
        msg = f"Malformed {AUTH_HEADER} header: expected '{BEARER_PREFIX}' prefix"
        return False, msg

    token = auth_value.removeprefix(BEARER_PREFIX)
    if not token:
        msg = f"Empty token after '{BEARER_PREFIX}' prefix"
        return False, msg

    user_id = _resolve_token(token)
    return True, user_id


def log_request(method: str, path: str, status_code: int, duration_ms: float) -> None:
    """Log a completed HTTP request.

    Args:
        method: The HTTP method (GET, POST, etc.).
        path: The request path.
        status_code: The response status code.
        duration_ms: How long the request took in milliseconds.
    """
    _logger.info(
        "%s %s -> %d (%.1fms)",
        method,
        path,
        status_code,
        duration_ms,
    )


def measure_duration(start_time: float) -> float:
    """Calculate elapsed time in milliseconds since start_time.

    Args:
        start_time: The start timestamp from time.time().

    Returns:
        Elapsed milliseconds as a float.
    """
    elapsed = time() - start_time
    return elapsed * 1000.0


def _resolve_token(token: str) -> str:
    """Derive a user ID from a bearer token by hashing it.

    Args:
        token: The bearer token string.

    Returns:
        A deterministic user ID derived from the token.
    """
    full_hex = sha256(token.encode()).hexdigest()
    digest = full_hex[0:TOKEN_HASH_LENGTH]
    return f"user_{digest}"
