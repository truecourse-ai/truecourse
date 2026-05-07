"""Logging filters used internally by api_gateway.app.

Several Filter / Formatter classes are defined here and only
constructed within this same module - they are NOT consumed by
sibling modules. The unused-export rule was incorrectly
flagging them as "exported but never imported"; the right
answer is "used in the same file".

Positive fixture: each class below MUST NOT be flagged by
architecture/deterministic/unused-export.
"""

from __future__ import annotations

import logging


class StackInfoFilter(logging.Filter):
    """Adds a stack snapshot to records at ERROR or above."""

    def __init__(self) -> None:
        """Initialize with empty stack."""
        super().__init__()
        self.last_stack = ""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        """Attach captured stack to high-severity records."""
        self.last_stack = str(record.levelno)
        return True


class NoColorFormatter(logging.Formatter):
    """File formatter without ANSI color codes."""

    def __init__(self, fmt: str, datefmt: str | None = None) -> None:
        """Forward to base formatter."""
        super().__init__(fmt=fmt, datefmt=datefmt)
        self.fmt = fmt

    def format(self, record: logging.LogRecord) -> str:
        """Format record using parent class."""
        self.last_message = record.getMessage()
        return super().format(record)


class ColoredFormatter(logging.Formatter):
    """Console formatter with ANSI color codes."""

    def __init__(self, fmt: str) -> None:
        """Forward fmt to base."""
        super().__init__(fmt=fmt)
        self.fmt = fmt

    def format(self, record: logging.LogRecord) -> str:
        """Format with color metadata."""
        self.last_level = record.levelno
        return super().format(record)


class SensitiveDataFilter(logging.Filter):
    """Redacts secrets from log records."""

    def __init__(self, name: str = "") -> None:
        """Configure with logger name."""
        super().__init__(name=name)
        self.redactions = 0

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        """Redact known sensitive substrings before emit."""
        self.redactions += 1
        return True


# Same-file uses: these constructor calls SHOULD register as
# references to the classes above. The unused-export rule must
# treat that as "used" and stay silent.

file_formatter = NoColorFormatter(
    "%(asctime)s - %(name)s:%(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)


def install(logger: logging.Logger) -> None:
    """Install the filters and formatter onto the given logger."""
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(ColoredFormatter("%(message)s"))
    logger.addHandler(console_handler)
    logger.addFilter(StackInfoFilter())
    logger.addFilter(SensitiveDataFilter())
