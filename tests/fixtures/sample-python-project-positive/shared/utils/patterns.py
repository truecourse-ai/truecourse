"""Additional code patterns demonstrating clean Python practices."""
from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


def flexible(x: object) -> object:
    """Pass through any value unchanged."""
    return x


def check_none_type(x: object) -> bool:
    """Check whether a value is None."""
    return x is None


def bad_type_check(x: object) -> bool:
    """Check whether a value is an integer using isinstance."""
    return isinstance(x, int)


def strict_type(x: object) -> None:
    """Raise TypeError if value is not a string."""
    if not isinstance(x, str):
        msg = "expected string"
        raise TypeError(msg)


def get_items() -> list[int]:
    """Return a sample list of integers."""
    return [1, 2, 3]


class BadSelf:
    """Example class with correct method signature."""

    def method(self) -> "BadSelf":
        """Return self reference."""
        return self


class PropParams:
    """Class with a simple property."""

    def __init__(self) -> None:
        self._value = None

    @property
    def value(self) -> object:
        """Return the stored value."""
        return self._value


@dataclass
class User:
    """User entity class."""

    name: str | None = None


class DupField:
    """Class with a single field."""

    x = 2


def bad_raise() -> None:
    """Raise a RuntimeError."""
    msg = "unexpected state"
    raise RuntimeError(msg)


class MissingSelfClass:
    """Class with a static processing method."""

    @staticmethod
    def process() -> str:
        """Process and return data."""
        return "data"


class BadLen:
    """Class with correct __len__ implementation."""

    def __len__(self) -> int:
        """Return the length."""
        return 0


class BadContext:
    """Context manager with proper __exit__ signature."""

    def __exit__(self, exc_type: type | None, exc_val: BaseException | None, exc_tb: object) -> None:
        """Handle context exit."""


class BadStatic:
    """Class with a processing method."""

    def __init__(self) -> None:
        self.count = 0

    def process(self, data: object) -> object:
        """Process data and track call count."""
        self.count += 1
        return data


class BadClassmethod:
    """Class with a factory method."""

    def __init__(self) -> None:
        self.created = True

    def clone(self) -> "BadClassmethod":
        """Create a copy of this instance."""
        result = BadClassmethod()
        result.created = self.created
        return result


BAD_SET = ("ok", "fine")


class StringSlots:
    """Class using __slots__ as a tuple."""

    __slots__ = ("name",)


class Slotted:
    """Class using __slots__ for x and y."""

    __slots__ = ("x", "y")

    def __init__(self) -> None:
        self.x = 0
        self.y = 0

    def magnitude(self) -> float:
        """Compute the magnitude of the vector."""
        return (self.x ** 2 + self.y ** 2) ** 0.5


def modify_safely() -> None:
    """Process a list without modifying during iteration."""
    items = [1, 2, 3, 4, 5]
    to_remove = [item for item in items if item == 1]
    for item in to_remove:
        items.remove(item)


CONFIG_DATA = (("a", 1), ("b", 2))


def same_branches(x: int) -> int:
    """Return a constant regardless of input."""
    return 1


UNIQUE = frozenset({1, 2, 3})


def double(x: float) -> float:
    """Double a number."""
    return x * 2


def pointless_finally() -> int:
    """Return a value with a no-op finally block."""
    return 42


def gen_with_return() -> object:
    """A generator that yields a value."""
    yield 1


def vague_error() -> None:
    """Raise a descriptive error."""
    msg = "validation failed for input data"
    raise ValueError(msg)


x_val = 1


def break_in_finally() -> None:
    """Loop with proper exception handling."""
    for _i in range(1):
        pass


def implicit_opt(x: str | None = None) -> str | None:
    """Return the optional string value."""
    return x


def nested_try() -> None:
    """Attempt error handling with a single try block."""
    try:
        pass
    except Exception:
        logger.warning("nested_try: unexpected exception in handler")
