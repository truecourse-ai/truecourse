"""Phase 6 heuristic improvements coverage.

Exercises patterns that the pre-Phase-6 visitors flagged incorrectly:
  - Class-body bare type annotations (Pydantic/dataclass fields)
  - datetime.now() with positional timezone argument
  - Async dunder methods without await

Zero violations expected.
"""
from datetime import datetime, timezone


class Config:
    """Plain class with intentional bare type annotations."""
    name: str
    value: int
    items: list


class AppSettings:
    """Another class with field declarations."""
    debug: bool
    host: str
    port: int


def get_utc_now() -> datetime:
    """datetime.now with positional timezone arg is timezone-aware."""
    return datetime.now(timezone.utc)


def get_utc_string() -> str:
    """datetime.now with positional timezone produces isoformat."""
    return datetime.now(timezone.utc).isoformat()


class AsyncResource:
    """Async context manager with dunder methods that do not await."""

    async def __aenter__(self) -> "AsyncResource":
        """Must be async for protocol compliance. No await needed."""
        return self

    async def __aexit__(self, exc_type: type, exc_val: Exception, exc_tb: object) -> bool:
        """Must be async for protocol compliance. No await needed."""
        return False
