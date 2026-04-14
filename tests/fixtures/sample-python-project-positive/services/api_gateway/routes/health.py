"""Health check route for the API gateway."""
from flask import Blueprint, jsonify

health_bp = Blueprint("health", __name__)


@health_bp.route("/", methods=["GET"])
def health_check() -> tuple:
    """Return the service health status."""
    return jsonify({"status": "ok"})
