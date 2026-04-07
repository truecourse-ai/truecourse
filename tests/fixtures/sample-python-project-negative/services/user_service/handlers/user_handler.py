from flask import request, jsonify
from ..services.user_service import UserService
from shared.utils.validators import validate_email

user_service = UserService()


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_users():
    users = user_service.get_all()
    return jsonify(users)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_user_by_id(user_id: str):
    user = user_service.get_by_id(user_id)
    if not user:
        return jsonify({"error": "Not found"}), 404
    return jsonify(user)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def create_user():
    data = request.get_json()
    name = data["name"]
    email = data["email"]
    if not validate_email(email):
        return jsonify({"error": "Invalid email"}), 400
    user = user_service.create({"name": name, "email": email})
    return jsonify(user), 201


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def delete_user(user_id: str):
    user_service.delete(user_id)
    return "", 204
