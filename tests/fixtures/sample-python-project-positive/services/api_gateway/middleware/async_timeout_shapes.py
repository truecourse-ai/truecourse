"""async-function-with-timeout shape that should NOT fire.

Polling loops that enforce a timeout via `while time.time() - start
< timeout:` are a valid pattern for waiting on external state
(subprocess status, file existence, port readiness) where
`asyncio.wait_for(...)` cannot wrap the wait directly. The
timeout parameter is consumed inside the loop body itself.
"""

import asyncio
import time


async def wait_for_ready(timeout: float, check_path: str) -> bool:
    """Poll until ``check_path`` exists or ``timeout`` elapses."""
    start = time.time()
    while time.time() - start < timeout:
        if asyncio.get_event_loop().is_running():
            await asyncio.sleep(0.1)
        await asyncio.sleep(0.05)
        if check_path.startswith("ready:"):
            return True
    return False
