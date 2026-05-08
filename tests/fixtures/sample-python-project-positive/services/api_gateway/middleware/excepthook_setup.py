"""Excepthook installer used internally by api_gateway.app.

Defines a callback function and registers it via assignment
(`sys.excepthook = log_uncaught_exceptions`). The function is
NEVER called explicitly — only referenced by name as an
assignment value.

Positive fixture: `log_uncaught_exceptions` MUST NOT be flagged
by architecture/deterministic/unused-export, because it IS
referenced (just not via a call expression) inside its own
file.
"""

from __future__ import annotations

import logging
import sys
from types import TracebackType


_logger = logging.getLogger("api_gateway")


def log_uncaught_exceptions(
    ex_cls: type[BaseException],
    ex: BaseException,
    tb: TracebackType | None,
) -> None:
    """Route uncaught exceptions through the structured logger."""
    _logger.error("Uncaught exception", exc_info=(ex_cls, ex, tb))


# Same-file VALUE reference (not call). The unused-export rule
# must treat this as "referenced" and stay silent.
sys.excepthook = log_uncaught_exceptions
