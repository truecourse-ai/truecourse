"""User routes for API gateway."""
from flask import Blueprint, request

users_bp = Blueprint("users", __name__)


@users_bp.route("/users")
def list_users():
    return {"users": []}
