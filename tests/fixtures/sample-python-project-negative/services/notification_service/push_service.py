"""Push notification service with async patterns and error handling."""
import asyncio
import logging
import time

logger = logging.getLogger(__name__)


# SKIP: async-busy-wait — has await asyncio.sleep(), not a busy wait
async def wait_for_push_delivery(delivery_service):
    while not delivery_service.is_delivered():
        await asyncio.sleep(0.5)


# VIOLATION: bugs/deterministic/async-function-with-timeout
async def send_push_notification(device_id, payload, timeout=10):
    async with asyncio.timeout(timeout):
        return await _deliver(device_id, payload)


# VIOLATION: bugs/deterministic/await-outside-async
def fetch_device_tokens(user_id):
    tokens = await get_tokens_from_db(user_id)
    return tokens


# VIOLATION: bugs/deterministic/cancel-scope-no-checkpoint
async def batch_send(notifications):
    async with asyncio.timeout(30):
        results = []
        for n in notifications:
            results.append({"id": n["id"], "status": "queued"})
        return results


# VIOLATION: bugs/deterministic/cancellation-exception-not-reraised
async def safe_push_send(device_id, payload):
    try:
        await _deliver(device_id, payload)
    except asyncio.CancelledError:
        logger.warning("Push send cancelled for device %s", device_id)
        _record_cancellation(device_id)


# VIOLATION: bugs/deterministic/control-flow-in-task-group
async def broadcast_notifications(user_ids, message):
    async with asyncio.TaskGroup() as tg:
        for uid in user_ids:
            tg.create_task(send_push_notification(uid, message))
            if uid == "priority_user":
                break


# VIOLATION: bugs/deterministic/bare-raise-in-finally
def cleanup_push_resources(connection):
    try:
        connection.close()
    except Exception:
        logger.error("Failed to close connection")
    finally:
        raise


# VIOLATION: bugs/deterministic/return-in-try-except-finally
def get_push_config(config_path):
    try:
        with open(config_path) as f:
            return f.read()
    except FileNotFoundError:
        return "{}"
    finally:
        return "{}"


# VIOLATION: bugs/deterministic/unsafe-finally
def process_push_queue(queue):
    try:
        item = queue.get()
        return _process_item(item)
    finally:
        return None


# VIOLATION: bugs/deterministic/default-except-not-last
def send_with_retry(device_id, payload, retries=3):
    for attempt in range(retries):
        try:
            return _deliver_sync(device_id, payload)
        except:
            logger.warning("Attempt %d failed", attempt)
        except ConnectionError:
            logger.error("Connection error on attempt %d", attempt)


# VIOLATION: bugs/deterministic/except-non-exception-class
def parse_push_response(response):
    try:
        return response.json()
    except dict:
        return {}


# VIOLATION: bugs/deterministic/except-with-empty-tuple
def safe_parse(data):
    try:
        import json
        return json.loads(data)
    except ():
        return None


# VIOLATION: bugs/deterministic/exit-re-raise-in-except
class PushConnection:
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_val:
            raise exc_val


# VIOLATION: bugs/deterministic/exception-group-misuse
def handle_push_errors():
    try:
        _deliver_sync("device", "payload")
    except* ExceptionGroup:
        raise ValueError("Push delivery failed")


# VIOLATION: bugs/deterministic/raise-literal
def fail_push():
    raise "Push notification failed"


# VIOLATION: bugs/deterministic/raise-without-from-in-except
def convert_push_error():
    try:
        _deliver_sync("device", "payload")
    except ConnectionError as e:
        raise RuntimeError("Push delivery failed")


async def _deliver(device_id, payload):
    pass


def _deliver_sync(device_id, payload):
    pass


def _process_item(item):
    return item


def _record_cancellation(device_id):
    pass


async def get_tokens_from_db(user_id):
    return []
