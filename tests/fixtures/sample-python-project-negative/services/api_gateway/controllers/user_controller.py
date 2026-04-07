from flask import request, jsonify
from ..services.user_service import UserService


# VIOLATION: style/deterministic/docstring-completeness
class UserController:
    def __init__(self):
        self.user_service = UserService()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def get_all(self):
        users = self.user_service.find_all()
        return jsonify(users)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def get_by_id(self, user_id: str):
        user = self.user_service.find_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        return jsonify(user)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def create(self):
        data = request.get_json()
        user = self.user_service.create(data)
        return jsonify(user), 201

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def delete(self, user_id: str):
        self.user_service.delete(user_id)
        return "", 204
