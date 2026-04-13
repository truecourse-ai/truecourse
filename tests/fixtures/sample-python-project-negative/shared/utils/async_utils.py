"""Async utility functions with concurrency bug patterns."""
import asyncio
import logging
import time
import trio

logger = logging.getLogger(__name__)


# SKIP: async-busy-wait — has await asyncio.sleep(), not a busy wait
async def poll_until_ready(service):
    while not service.ready:
        await asyncio.sleep(0.05)


# VIOLATION: bugs/deterministic/async-function-with-timeout
async def fetch_with_deadline(url, deadline=5.0):
    return await asyncio.get_event_loop().run_in_executor(None, lambda: url)


# VIOLATION: bugs/deterministic/await-outside-async
def sync_fetch(url):
    result = await fetch_with_deadline(url)
    return result


# VIOLATION: bugs/deterministic/cancel-scope-no-checkpoint
async def timed_computation(data):
    async with asyncio.timeout(5):
        result = sum(x ** 2 for x in data)
        return result


# VIOLATION: bugs/deterministic/cancellation-exception-not-reraised
async def resilient_task(coro):
    try:
        return await coro
    except asyncio.CancelledError:
        logger.info("Task was cancelled, cleaning up")
        cleanup_resources()


# VIOLATION: bugs/deterministic/control-flow-in-task-group
async def fan_out_tasks(items):
    async with asyncio.TaskGroup() as tg:
        for item in items:
            tg.create_task(process_item(item))
            if item.get("stop"):
                return


# VIOLATION: bugs/deterministic/trio-sync-call
async def trio_worker():
    import trio
    time.sleep(1)
    await trio.sleep(0)


# VIOLATION: bugs/deterministic/yield-from-in-async
async def async_chain(iterables):
    for iterable in iterables:
        yield from iterable


async def process_item(item):
    return item


def cleanup_resources():
    pass


# --- Async pattern TPs (moved from synthetic batch files) ---

# VIOLATION: bugs/deterministic/async-busy-wait
async def busy_poll_no_sleep(check_fn):
    """Busy wait without await — uses time.sleep instead of asyncio.sleep."""
    import time
    while True:
        if check_fn():
            return True
        time.sleep(1)


# VIOLATION: bugs/deterministic/cancellation-exception-not-reraised
async def swallow_cancel():
    """Catches CancelledError without re-raising — suppresses cancellation."""
    import asyncio
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        logging.warning("Cancelled but not re-raised")


# VIOLATION: code-quality/deterministic/require-await
async def compute_total(items: list) -> float:
    """Async function that never awaits — async keyword is unnecessary."""
    return sum(getattr(i, "value", 0) for i in items)


# VIOLATION: code-quality/deterministic/async-unused-async
async def format_full_name(first: str, last: str) -> str:
    """Async function that never uses await/async-for/async-with."""
    return f"{first} {last}"
