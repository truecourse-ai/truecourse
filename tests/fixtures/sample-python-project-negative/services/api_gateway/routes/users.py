from flask import Blueprint
from ..controllers.user_controller import UserController

users_bp = Blueprint("users", __name__)
controller = UserController()


@users_bp.route("/", methods=["GET"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_all():
    return controller.get_all()


@users_bp.route("/<user_id>", methods=["GET"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_by_id(user_id: str):
    return controller.get_by_id(user_id)


@users_bp.route("/", methods=["POST"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def create():
    return controller.create()


@users_bp.route("/<user_id>", methods=["DELETE"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def delete(user_id: str):
    return controller.delete(user_id)
