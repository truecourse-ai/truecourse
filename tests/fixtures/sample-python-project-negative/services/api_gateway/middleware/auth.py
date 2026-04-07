"""Authentication middleware."""
from functools import wraps
from flask import request


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("Authorization")
        if not token:
            return {"error": "unauthorized"}, 401
        return f(*args, **kwargs)
    return decorated
