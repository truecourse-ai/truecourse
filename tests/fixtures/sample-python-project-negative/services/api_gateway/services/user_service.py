import os
import requests
from shared.utils.formatters import format_user

USER_SERVICE_URL = os.environ.get("USER_SERVICE_URL", "http://localhost:3001")


# VIOLATION: style/deterministic/docstring-completeness
class UserService:
    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def find_all(self) -> list:
        # VIOLATION: reliability/deterministic/http-call-no-timeout
        response = requests.get(f"{USER_SERVICE_URL}/users")
        return [format_user(u) for u in response.json()]

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def find_by_id(self, user_id: str) -> dict | None:
        # VIOLATION: reliability/deterministic/http-call-no-timeout
        response = requests.get(f"{USER_SERVICE_URL}/users/{user_id}")
        return format_user(response.json())

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def create(self, data: dict) -> dict:
        # VIOLATION: reliability/deterministic/http-call-no-timeout
        response = requests.post(f"{USER_SERVICE_URL}/users", json=data)
        return format_user(response.json())

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def delete(self, user_id: str) -> None:
        # VIOLATION: reliability/deterministic/http-call-no-timeout
        requests.delete(f"{USER_SERVICE_URL}/users/{user_id}")
