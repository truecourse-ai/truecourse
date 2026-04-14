"""User service client for the API gateway."""
import os
import requests
from shared.utils.formatters import format_user

USER_SERVICE_URL = os.environ.get("USER_SERVICE_URL", "http://localhost:3001")
HTTP_TIMEOUT = 30


class UserService:
    """Client for communicating with the user microservice."""

    def __init__(self) -> None:
        self._base_url = USER_SERVICE_URL

    def find_all(self) -> list:
        """Fetch all users from the user service."""
        response = requests.get(f"{self._base_url}/users", timeout=HTTP_TIMEOUT)
        return [format_user(u) for u in response.json()]

    def find_by_id(self, user_id: str) -> dict | None:
        """Fetch a single user by their ID."""
        response = requests.get(f"{self._base_url}/users/{user_id}", timeout=HTTP_TIMEOUT)
        return format_user(response.json())

    def create(self, data: dict) -> dict:
        """Create a new user via the user service."""
        response = requests.post(f"{self._base_url}/users", json=data, timeout=HTTP_TIMEOUT)
        return format_user(response.json())

    def delete(self, user_id: str) -> None:
        """Delete a user by their ID."""
        requests.delete(f"{self._base_url}/users/{user_id}", timeout=HTTP_TIMEOUT)
