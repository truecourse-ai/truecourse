"""Admin routes for system management and monitoring."""
import os
import json
import sqlite3
import requests
from typing import Optional
from flask import Blueprint, request, jsonify, g

admin_bp = Blueprint("admin", __name__)

# Ambiguous Unicode characters in strings (visually similar to ASCII)
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
ADMIN_WELCOME = "Welc\u043eme to admin panel"
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
UNAUTHORIZED_MSG = "Acc\u0435ss denied"
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
SUCCESS_MSG = "\u0430dmin operation completed"
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
ERROR_PREFIX = "Err\u043er occurred"
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
CONFIG_LABEL = "C\u043enfig"
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
STATUS_LABEL = "Statu\u0455"
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
AUDIT_MSG = "Audit l\u043eg entry"
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
REPORT_TITLE = "Rep\u043ert"
# VIOLATION: code-quality/deterministic/ambiguous-unicode-character
DASHBOARD_TITLE = "D\u0430shboard"


@admin_bp.route("/dashboard", methods=["GET"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def dashboard():
    """Admin dashboard endpoint."""
    return jsonify({"message": ADMIN_WELCOME, "status": "ok"})


@admin_bp.route("/config", methods=["GET"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_config():
    """Return system configuration."""
    return jsonify({
        "debug": os.environ.get("DEBUG", "false"),
        "version": os.environ.get("VERSION", "unknown"),
    })


@admin_bp.route("/users/<user_id>/ban", methods=["POST"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def ban_user(user_id: str):
    """Ban a user by ID."""
    # VIOLATION: reliability/deterministic/http-call-no-timeout
    response = requests.post(
        f"http://localhost:3001/users/{user_id}/ban",
        json=request.json
    )
    return jsonify(response.json()), response.status_code


@admin_bp.route("/stats", methods=["GET"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_stats():
    """Get system statistics."""
    # VIOLATION: database/deterministic/connection-not-released
    conn = sqlite3.connect("analytics.db")
    cursor = conn.cursor()
    # VIOLATION: database/deterministic/select-star
    cursor.execute("SELECT * FROM daily_stats")
    stats = cursor.fetchall()
    return jsonify(stats)


@admin_bp.route("/sql", methods=["POST"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def run_query():
    """Run an arbitrary SQL query (admin only)."""
    query = request.json.get("query", "")
    conn = sqlite3.connect("analytics.db")
    # VIOLATION: security/deterministic/sql-injection
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM users WHERE name = '{query}'")
    return jsonify(cursor.fetchall())


@admin_bp.route("/audit", methods=["GET"])
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_audit_log():
    """Return audit log entries."""
    # VIOLATION: reliability/deterministic/http-call-no-timeout
    response = requests.get("http://localhost:3001/audit")
    return jsonify(response.json())


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def check_admin_auth(token):
    if not token:
        return False
    # VIOLATION: code-quality/deterministic/magic-value-comparison
    return len(token) > 20


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def format_admin_response(data, status_code=200):
    return {"data": data, "status": status_code}
