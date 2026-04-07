"""Bug violations: async/await, concurrency, and task management."""
import asyncio
import time
import trio


# VIOLATION: bugs/deterministic/await-outside-async
def not_async():
    await asyncio.sleep(1)


# VIOLATION: bugs/deterministic/asyncio-dangling-task
async def fire_and_forget():
    asyncio.create_task(some_coroutine())


# VIOLATION: bugs/deterministic/yield-from-in-async
async def bad_yield_from():
    yield from [1, 2, 3]


# VIOLATION: bugs/deterministic/blocking-call-in-async
async def blocking_in_async():
    time.sleep(5)


# VIOLATION: bugs/deterministic/async-busy-wait
async def busy_wait():
    while not done:
        await asyncio.sleep(0.1)


# VIOLATION: bugs/deterministic/async-function-with-timeout
async def no_timeout(timeout=30):
    await long_task()


# VIOLATION: bugs/deterministic/cancel-scope-no-checkpoint
async def no_checkpoint():
    with trio.CancelScope(deadline=5):
        x = compute_sync()


# VIOLATION: bugs/deterministic/control-flow-in-task-group
async def bad_task_group():
    async with asyncio.TaskGroup() as tg:
        tg.create_task(work())
        return "done"


# VIOLATION: bugs/deterministic/trio-sync-call
async def trio_sync():
    trio.sleep(1)


# VIOLATION: bugs/deterministic/yield-return-outside-function
return 1
