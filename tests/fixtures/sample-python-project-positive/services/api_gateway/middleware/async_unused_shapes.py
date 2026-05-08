"""async-unused-async / require-await shapes that should NOT
fire:

- `@classmethod async def get_instance(cls)` factory — protocol
  factory convention; async-ness is part of the contract.
- `@classmethod async def from_dict(cls, d)` — same.
- FastAPI exception handler `async def f(request, exc)` —
  framework expects async signature.
- FastAPI Depends provider returning a value.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class StoreFactory:
    """Async-factory protocol class."""

    @classmethod
    async def get_instance(cls) -> StoreFactory:
        return cls()

    @classmethod
    async def from_dict(cls, data: dict) -> StoreFactory:
        return cls(**data)

    @classmethod
    async def create(cls, name: str) -> StoreFactory:
        instance = cls()
        instance.name = name  # type: ignore[attr-defined]
        return instance
