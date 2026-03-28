from flask import Blueprint, jsonify
from ..services.health_service import HealthService

health_bp = Blueprint("health", __name__)
health_service = HealthService()


@health_bp.route("/", methods=["GET"])
def health_check():
    return jsonify(health_service.check())
