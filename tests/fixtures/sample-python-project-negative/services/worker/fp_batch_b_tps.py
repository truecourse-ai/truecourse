"""
Negative fixture: patterns that MUST trigger violations (true positives).
Covers batch B rules — each comment marks an expected violation.
"""
import asyncio
import logging
import time

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. unintentional-type-annotation: bare annotation with no assignment
# ---------------------------------------------------------------------------

def bad_annotation():
    # VIOLATION: bugs/deterministic/unintentional-type-annotation
    result: int
    return None


# ---------------------------------------------------------------------------
# 2. loop-at-most-one-iteration: unconditional exit, no continue
# ---------------------------------------------------------------------------

def always_returns_first(items: list):
    # VIOLATION: bugs/deterministic/loop-at-most-one-iteration
    for item in items:
        return item


# ---------------------------------------------------------------------------
# 3. async-busy-wait: sleep without await in async loop
# ---------------------------------------------------------------------------

async def busy_poll(check_fn):
    # VIOLATION: bugs/deterministic/async-busy-wait
    while True:
        if check_fn():
            return True
        time.sleep(1)


# ---------------------------------------------------------------------------
# 4. cancellation-exception-not-reraised: swallowed CancelledError
# ---------------------------------------------------------------------------

async def swallow_cancel():
    try:
        await asyncio.sleep(10)
    # VIOLATION: bugs/deterministic/cancellation-exception-not-reraised
    except asyncio.CancelledError:
        logger.warning("Cancelled but not re-raised")


# ---------------------------------------------------------------------------
# 5. nonlocal-without-binding: no enclosing variable
# ---------------------------------------------------------------------------

def outer_no_binding():
    def inner():
        # VIOLATION: bugs/deterministic/nonlocal-without-binding
        nonlocal missing_var
        missing_var = 42
    return inner


# ---------------------------------------------------------------------------
# 6. logging-exception-outside-handler: logger.exception outside except
# ---------------------------------------------------------------------------

def log_outside_handler(data):
    # VIOLATION: bugs/deterministic/logging-exception-outside-handler
    logger.exception("Something went wrong")
    return data


# ---------------------------------------------------------------------------
# 7. missing-fstring-syntax: actual missing f-prefix
# ---------------------------------------------------------------------------

def greet(name: str) -> str:
    # VIOLATION: bugs/deterministic/missing-fstring-syntax
    return "Hello {name}, welcome!"
