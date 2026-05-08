"""python-idiom-simplification shape that should NOT fire.

`for handler in logger.handlers[:]:` — iterating over a COPY of
the list while removing items from the original is the canonical
pattern for safe mutation during iteration. Replacing `[:]` with
`.copy()` would still work, but `[:]` is the time-honored way and
is universally recognized.
"""

import logging


def reset_logger_handlers(logger: logging.Logger) -> None:
    """Detach every handler currently attached to ``logger``."""
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)
