"""String utility functions for text processing."""
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

SHORT_THRESHOLD = 10


def format_string(text: str, prefix: str) -> str:
    """Format a string with a prefix."""
    return f"{prefix}: {text}"


def classify_string(s: str) -> str:
    """Classify a string by its length."""
    if len(s) == 0:
        return "empty"
    elif len(s) < SHORT_THRESHOLD:
        return "short"
    return "long"


__all__ = (
    "format_string",
    "classify_string",
)


class StringProcessor:
    """Processes strings with various operations."""

    def is_ready(self) -> bool:
        """Check if the processor is initialized."""
        return bool(self._state)

    def __init__(self) -> None:
        self._state = True


class TextFormatter:
    """Formats text with various transformations."""

    def __init__(self) -> None:
        self._uppercase = True

    def format(self, text: str) -> str:
        """Format text to uppercase."""
        if not self._uppercase:
            return text
        return text.upper()


class AdvancedFormatter(TextFormatter):
    """Extended text formatter with additional features."""

    def __init__(self) -> None:
        super().__init__()
        self._use_parent = True

    def format(self, text: str) -> str:
        """Format text using parent implementation."""
        if not self._use_parent:
            return text
        return super().format(text)


class StringCollection:
    """A collection of strings with proper special methods."""

    def __init__(self) -> None:
        self._items: list = []

    def __len__(self) -> int:
        """Return the number of items."""
        return len(self._items)

    def __bool__(self) -> bool:
        """Return whether the collection is non-empty."""
        return len(self._items) > 0

    def __str__(self) -> str:
        """Return a string representation."""
        return str(self._items)


class CharIterator:
    """Iterator over characters in a string."""

    def __init__(self, text: str) -> None:
        self._chars = list(text)
        self._index = 0

    def __iter__(self) -> "CharIterator":
        """Return self as the iterator."""
        return self

    def __next__(self) -> str:
        """Return the next character."""
        if self._index >= len(self._chars):
            raise StopIteration
        char = self._chars[self._index]
        self._index += 1
        return char


class WordStream:
    """Stream of words with proper iterator protocol."""

    def __init__(self) -> None:
        self._words: list = []
        self._index = 0

    def __iter__(self) -> "WordStream":
        """Return self as the iterator."""
        return self

    def __next__(self) -> str:
        """Return the next word."""
        if self._index >= len(self._words):
            raise StopIteration
        word = self._words[self._index]
        self._index += 1
        return word


@dataclass
class FormattedString:
    """Holds a formatted string with encoding metadata."""

    text: str = ""
    encoding: str = "utf-8"


def get_format_hints() -> dict:
    """Return the type annotations for FormattedString."""
    return {"text": str, "encoding": str}


class LazyString:
    """Lazily evaluates string parts."""

    def __init__(self, parts: list) -> None:
        self.parts = parts

    def evaluate(self) -> str:
        """Evaluate all parts into a single string."""
        return "".join(str(p) for p in self.parts)
