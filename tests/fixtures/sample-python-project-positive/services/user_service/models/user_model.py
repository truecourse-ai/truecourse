"""User data model definitions."""
import logging

logger = logging.getLogger(__name__)


class UserModel:
    """Represents a user entity in the system."""

    def __init__(self, user_id: str, name: str, email: str) -> None:
        self.user_id = user_id
        self.name = name
        self.email = email
        self.active = True

    def to_dict(self) -> dict:
        """Convert the user model to a dictionary."""
        return {
            "id": self.user_id,
            "name": self.name,
            "email": self.email,
            "active": self.active,
        }
