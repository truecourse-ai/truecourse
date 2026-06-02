"""Auth dependencies."""

from fastapi import Request


def require_bearer(request: Request) -> None:
    if "authorization" not in request.headers:
        raise RuntimeError("missing bearer token")


def require_admin(request: Request) -> None:
    pass
