"""User service client for API gateway."""
import requests


class UserServiceClient:
    def __init__(self, base_url):
        self.base_url = base_url

    def get_user(self, user_id):
        return requests.get(f"{self.base_url}/users/{user_id}").json()
