"""User route handlers for the API gateway."""
import logging

from flask import Blueprint

logger = logging.getLogger(__name__)

users_bp = Blueprint("users", __name__)


@users_bp.route("/", methods=["GET"])
def get_all() -> tuple:
    """Return all users."""
    return {"users": []}, 200


@users_bp.route("/<user_id>", methods=["GET"])
def get_by_id(user_id: str) -> tuple:
    """Return a user by ID."""
    return {"id": user_id}, 200


@users_bp.route("/", methods=["POST"])
def create() -> tuple:
    """Create a new user."""
    return {"created": True}, 201


@users_bp.route("/<user_id>", methods=["DELETE"])
def delete(user_id: str) -> tuple:
    """Delete a user by ID."""
    return "", 204
