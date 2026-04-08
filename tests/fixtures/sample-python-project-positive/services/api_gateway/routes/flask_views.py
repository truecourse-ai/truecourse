"""Flask class-based views."""
from flask import Flask
from flask.views import MethodView

app = Flask(__name__)


class UserListView(MethodView):
    """View for listing and creating users."""

    def __init__(self) -> None:
        super().__init__()
        self._users: list = []

    def get(self) -> dict:
        """Return a list of users."""
        return {"users": list(self._get_users())}

    def post(self) -> dict:
        """Create a new user."""
        self._users.append({"created": True})
        return {"created": True}

    def _get_users(self) -> list:
        """Retrieve users from storage."""
        return list(self._users)


app.add_url_rule("/users", view_func=UserListView.as_view("user_list"))
