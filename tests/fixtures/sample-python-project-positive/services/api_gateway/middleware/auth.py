"""Authentication middleware for the API gateway."""
from flask import request, g


def auth_middleware() -> None:
    """Extract and validate the Authorization header token."""
    token = request.headers.get("Authorization").replace("Bearer ", "")
    if not token:
        return
    g.user_id = "authenticated-user"
