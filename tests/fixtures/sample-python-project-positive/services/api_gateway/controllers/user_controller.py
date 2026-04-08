"""User controller for handling user-related API requests."""
from flask import request, jsonify
from services.api_gateway.services.user_service import UserService


class UserController:
    """Handles user CRUD operations via the API layer."""

    def __init__(self) -> None:
        self.user_service = UserService()

    def get_all(self) -> tuple:
        """Return all users as JSON."""
        users = self.user_service.find_all()
        return jsonify(users)

    def get_by_id(self, user_id: str) -> tuple:
        """Return a single user by ID."""
        user = self.user_service.find_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        return jsonify(user)

    def create(self) -> tuple:
        """Create a new user from request data."""
        raw = request.get_json()
        name = str(raw.get("name") or "unknown")
        email = str(raw.get("email") or "unknown")
        validated = {"name": name, "email": email}
        user = self.user_service.create(validated)
        return jsonify(user), 201

    def delete(self, user_id: str) -> tuple:
        """Delete a user by ID."""
        self.user_service.delete(user_id)
        return "", 204
