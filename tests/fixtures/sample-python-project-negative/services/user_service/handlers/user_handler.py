"""User request handler."""
from flask import request, jsonify


def handle_get_user(user_id):
    return jsonify({"id": user_id, "name": "alice"})


def handle_create_user():
    data = request.json
    return jsonify({"created": True}), 201
