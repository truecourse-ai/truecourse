import os
import requests
from shared.utils.formatters import format_user

USER_SERVICE_URL = os.environ.get("USER_SERVICE_URL", "http://localhost:3001")


class UserService:
    def find_all(self) -> list:
        response = requests.get(f"{USER_SERVICE_URL}/users")
        return [format_user(u) for u in response.json()]

    def find_by_id(self, user_id: str) -> dict | None:
        response = requests.get(f"{USER_SERVICE_URL}/users/{user_id}")
        return format_user(response.json())

    def create(self, data: dict) -> dict:
        response = requests.post(f"{USER_SERVICE_URL}/users", json=data)
        return format_user(response.json())

    def delete(self, user_id: str) -> None:
        requests.delete(f"{USER_SERVICE_URL}/users/{user_id}")
