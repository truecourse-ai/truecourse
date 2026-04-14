"""Performance-sensitive code with optimization patterns."""
import logging

logger = logging.getLogger(__name__)


class BaseEvent:
    """Base event class with __slots__ for memory efficiency."""

    __slots__ = ("event_id", "timestamp")

    def __init__(self, event_id: str, timestamp: float) -> None:
        self.event_id = event_id
        self.timestamp = timestamp

    def to_dict(self) -> dict:
        """Serialize event to a dictionary."""
        return {"event_id": self.event_id, "timestamp": self.timestamp}


class UserEvent(BaseEvent):
    """User event subclass with slots."""

    __slots__ = ("user_id",)

    def __init__(self, event_id: str, timestamp: float, user_id: str) -> None:
        super().__init__(event_id, timestamp)
        self.user_id = user_id

    def to_dict(self) -> dict:
        """Serialize user event to a dictionary."""
        base = super().to_dict()
        base["user_id"] = self.user_id
        return base


def normalize_ids(raw_ids: list) -> list:
    """Convert string IDs to integers."""
    return [int(raw) for raw in raw_ids]
