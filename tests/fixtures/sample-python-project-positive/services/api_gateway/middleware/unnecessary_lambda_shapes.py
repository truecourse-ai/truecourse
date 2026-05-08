"""unnecessary-lambda shape that should NOT fire.

SQLAlchemy / dataclass / Pydantic kwargs that take a CALLABLE
which is invoked per-instance (`default=`, `default_factory=`,
`onupdate=`, `server_default=`). Replacing
``default=lambda: datetime.now()`` with ``default=datetime.now()``
evaluates the call ONCE at import time, freezing the value for
every row — that's a semantic change, not a simplification.
"""

from datetime import datetime, UTC


class Column:
    """Stand-in for sqlalchemy.Column used by the fixture."""

    def __init__(self, *, default=None, onupdate=None) -> None:
        self.default = default
        self.onupdate = onupdate

    def render(self) -> str:
        """Render the column's current default for debugging."""
        return f"<Column default={self.default!r} onupdate={self.onupdate!r}>"


class Conversation:
    """Audit fields use callables so each row gets a fresh timestamp."""

    created_at = Column(
        default=lambda: datetime.now(UTC).isoformat(),
        onupdate=lambda: datetime.now(UTC).isoformat(),
    )
