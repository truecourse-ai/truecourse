"""API helpers -- sits in api/ directory but is NOT a route handler.

Tests: files in **/api/** that only import framework utilities (HTTPException, Depends)
should NOT be classified as API layer and should NOT generate flow entry points.
"""

from flask import HTTPException


def require_auth(token: str) -> dict:
    """Validate auth token and return user info."""
    if not token or len(token) < 8:
        raise HTTPException(description="Invalid token", response=401)
    return {"user_id": 1, "role": "admin"}


def format_error(message: str, code: int = 400) -> dict:
    """Format a standard error response."""
    return {"error": message, "code": code}
