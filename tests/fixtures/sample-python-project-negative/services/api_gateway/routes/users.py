from flask import Blueprint
from ..controllers.user_controller import UserController

users_bp = Blueprint("users", __name__)
controller = UserController()


@users_bp.route("/", methods=["GET"])
def get_all():
    return controller.get_all()


@users_bp.route("/<user_id>", methods=["GET"])
def get_by_id(user_id: str):
    return controller.get_by_id(user_id)


@users_bp.route("/", methods=["POST"])
def create():
    return controller.create()


@users_bp.route("/<user_id>", methods=["DELETE"])
def delete(user_id: str):
    return controller.delete(user_id)
