"""Route handlers for the API gateway."""

from json import dumps, loads, JSONDecodeError

HEALTH_PATH = "/health"
USERS_PATH = "/users"
STATUS_OK = "ok"
STATUS_NOT_FOUND = "not_found"
STATUS_BAD_REQUEST = "bad_request"
HTTP_OK = 200
HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404


def _safe_json_parse(raw: str) -> tuple[object, str]:
    """Parse a JSON string, returning parsed data or an error message."""
    try:
        parsed = loads(raw)
    except (JSONDecodeError, TypeError) as exc:
        return None, str(exc)
    return parsed, ""


def handle_get_request(path: str) -> tuple[int, str]:
    """Route a GET request to the appropriate handler.

    Args:
        path: The URL path from the request.

    Returns:
        A tuple of (status_code, response_body_json).
    """
    if path == HEALTH_PATH:
        return _health_check()

    if path == USERS_PATH:
        return _list_users()

    return _not_found(path)


def handle_post_request(path: str, raw_body: str) -> tuple[int, str]:
    """Route a POST request to the appropriate handler.

    Args:
        path: The URL path from the request.
        raw_body: The raw request body string.

    Returns:
        A tuple of (status_code, response_body_json).
    """
    if path == USERS_PATH:
        return _create_user(raw_body)

    return _not_found(path)


def _health_check() -> tuple[int, str]:
    """Return a health check response.

    Returns:
        A tuple of (200, health_json).
    """
    payload = dumps({"status": STATUS_OK})
    return HTTP_OK, payload


def _list_users() -> tuple[int, str]:
    """Return a placeholder list of users.

    Returns:
        A tuple of (200, users_json).
    """
    payload = dumps({"users": []})
    return HTTP_OK, payload


def _create_user(raw_body: str) -> tuple[int, str]:
    """Parse a user creation request and return a confirmation.

    Args:
        raw_body: The raw JSON body from the request.

    Returns:
        A tuple of (status_code, response_json).
    """
    result, err = _safe_json_parse(raw_body)
    if err:
        payload = dumps({"error": err})
        return HTTP_BAD_REQUEST, payload

    if not isinstance(result, dict):
        payload = dumps({"error": "Request body must be a JSON object"})
        return HTTP_BAD_REQUEST, payload

    payload = dumps({"received": True})
    return HTTP_OK, payload


def _not_found(path: str) -> tuple[int, str]:
    """Return a 404 response for an unknown path.

    Args:
        path: The unmatched URL path.

    Returns:
        A tuple of (404, error_json).
    """
    payload = dumps({"status": STATUS_NOT_FOUND, "path": path})
    return HTTP_NOT_FOUND, payload
