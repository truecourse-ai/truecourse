"""Admin routes for system management and monitoring."""
import os
import logging

import requests
from flask import Blueprint, jsonify

logger = logging.getLogger(__name__)

admin_bp = Blueprint("admin", __name__)

ADMIN_WELCOME = "Welcome to admin panel"
MIN_TOKEN_LENGTH = 20
HTTP_TIMEOUT = 30
HTTP_OK = 200
METHOD_GET = "GET"


@admin_bp.route("/dashboard", methods=[METHOD_GET])
def dashboard() -> tuple:
    """Admin dashboard endpoint."""
    return jsonify({"message": ADMIN_WELCOME, "status": "ok"})


@admin_bp.route("/config", methods=[METHOD_GET])
def get_config() -> tuple:
    """Return system configuration."""
    return jsonify({
        "debug": os.environ.get("DEBUG", "false"),
        "version": os.environ.get("VERSION", "unknown"),
    })


@admin_bp.route("/audit", methods=[METHOD_GET])
def get_audit_log() -> tuple:
    """Return audit log entries."""
    response = requests.get("http://localhost:3001/audit", timeout=HTTP_TIMEOUT)
    return jsonify(response.json())


def check_admin_auth(token: str) -> bool:
    """Verify an admin authentication token meets minimum length."""
    if not token:
        return False
    return len(token) > MIN_TOKEN_LENGTH


def format_admin_response(data: dict, status_code: int = 200) -> dict:
    """Format a standard admin API response."""
    return {"data": data, "status": status_code}
