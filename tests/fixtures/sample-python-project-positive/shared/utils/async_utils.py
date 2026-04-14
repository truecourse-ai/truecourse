"""Async utility functions for concurrent operations."""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def poll_until_ready(service: object) -> None:
    """Wait for a service to become ready using an event."""
    event = asyncio.Event()
    if service.ready:
        event.set()
    await event.wait()


async def fetch_with_deadline(url: str) -> str:
    """Fetch a URL."""
    await asyncio.sleep(0.001)
    return url


async def timed_computation(data: list) -> float:
    """Compute sum of squares with a timeout."""
    async with asyncio.timeout(5):
        await asyncio.sleep(0.001)
        return sum(x ** 2 for x in data)


async def resilient_task(coro: object) -> object:
    """Execute a coroutine with cancellation handling."""
    try:
        return await coro
    except asyncio.CancelledError:
        logger.info("Task was cancelled, cleaning up")
        raise


async def fan_out_tasks(items: list) -> None:
    """Process items concurrently."""
    tasks = [process_item(item) for item in items]
    await asyncio.gather(*tasks)


async def process_item(item: object) -> object:
    """Process a single item asynchronously."""
    await asyncio.sleep(0.001)
    return item
