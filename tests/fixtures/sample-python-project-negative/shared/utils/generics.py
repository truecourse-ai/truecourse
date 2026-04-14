"""Generic utility classes with type parameter issues."""
from typing import TypeVar, Generic

T = TypeVar('T')


# VIOLATION: bugs/deterministic/class-mixed-typevars
class Repository[U](Generic[T]):
    """Mixes PEP 695 type params [U] with old-style Generic[T]."""

    def get(self, id: int) -> T:
        raise NotImplementedError

    def save(self, entity: U) -> None:
        raise NotImplementedError
