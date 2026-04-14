from flask import Blueprint
from .handlers.user_handler import get_users, get_user_by_id, create_user, delete_user

users_bp = Blueprint("users", __name__)

users_bp.route("/", methods=["GET"])(get_users)
users_bp.route("/<user_id>", methods=["GET"])(get_user_by_id)
users_bp.route("/", methods=["POST"])(create_user)
users_bp.route("/<user_id>", methods=["DELETE"])(delete_user)
