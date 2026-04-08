"""Token model for authentication tokens."""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class TokenModel:
    """Represents an authentication token."""

    def __init__(self, token: str, user_id: str) -> None:
        self.token = token
        self.user_id = user_id
        self.created_at = datetime.now(tz=timezone.utc)
        self.expired = False

    def is_valid(self) -> bool:
        """Check whether the token is still valid."""
        return not self.expired
