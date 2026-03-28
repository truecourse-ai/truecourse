from flask import request, jsonify
from ..services.user_service import UserService


class UserController:
    def __init__(self):
        self.user_service = UserService()

    def get_all(self):
        users = self.user_service.find_all()
        return jsonify(users)

    def get_by_id(self, user_id: str):
        user = self.user_service.find_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        return jsonify(user)

    def create(self):
        data = request.get_json()
        user = self.user_service.create(data)
        return jsonify(user), 201

    def delete(self, user_id: str):
        self.user_service.delete(user_id)
        return "", 204
