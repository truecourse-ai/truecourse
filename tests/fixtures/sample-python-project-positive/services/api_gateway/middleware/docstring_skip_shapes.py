"""Shapes the docstring-completeness rule should NOT flag.

Each section below is a structurally distinct case identified
by the FP audit. None should produce
style/deterministic/docstring-completeness violations.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum, IntEnum
from logging import Filter, Formatter, LogRecord, LoggerAdapter
from typing import NamedTuple, TypedDict


class StatusEnum(Enum):
    PENDING = "pending"
    DONE = "done"


class HttpCode(IntEnum):
    OK = 200
    NOT_FOUND = 404


@dataclass
class UserRow:
    id: int
    name: str
    email: str


class _LoggedDict(TypedDict):
    method: str
    path: str
    status: int


class _LoggedTuple(NamedTuple):
    request_id: str
    duration_ms: int


class StackInfoFilter(Filter):
    """Adds stack info to records at ERROR or above."""

    def filter(self, record: LogRecord) -> bool:
        self.last_level = record.levelno
        return True


class NoColorFormatter(Formatter):
    """File formatter without ANSI codes."""

    def format(self, record: LogRecord) -> str:
        return super().format(record)


class ContextLoggerAdapter(LoggerAdapter):
    """Logger adapter that injects request context."""

    def process(self, msg: str, kwargs: dict) -> tuple[str, dict]:
        kwargs.setdefault("extra", {})
        return msg, kwargs


class AbstractStore(ABC):
    @abstractmethod
    def get(self, key: str) -> str: ...

    @abstractmethod
    def set(self, key: str, value: str) -> None: ...


class PermissionsError(Exception):
    pass


def build_handler() -> tuple[object, type]:
    """Public outer factory."""

    def handler(req: str) -> str:
        return req.upper()

    class Local:
        x: int = 0

    return handler, Local
