"""Push notification service with async delivery patterns."""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def wait_for_push_delivery(delivery_service: object) -> None:
    """Wait until push delivery is confirmed using an event."""
    event = asyncio.Event()
    if delivery_service.is_delivered():
        event.set()
    await event.wait()


async def send_push_notification(device_id: str, payload: dict) -> object:
    """Send a push notification to a device."""
    return await _deliver(device_id, payload)


async def batch_send(notifications: list) -> list:
    """Send a batch of push notifications."""
    results = []
    for n in notifications:
        result = await _deliver(n.get("device_id") or "", n)
        results.append({"id": n.get("id"), "status": "sent", "result": result})
    return results


async def safe_push_send(device_id: str, payload: dict) -> None:
    """Send a push notification with cancellation support."""
    try:
        await _deliver(device_id, payload)
    except asyncio.CancelledError:
        logger.warning("Push send cancelled for device %s", device_id)
        raise


async def broadcast_notifications(user_ids: list, message: dict) -> None:
    """Broadcast notifications to multiple users."""
    tasks = [send_push_notification(uid, message) for uid in user_ids]
    await asyncio.gather(*tasks)


async def _deliver(device_id: str, payload: dict) -> dict:
    """Deliver a push notification to a device."""
    await asyncio.sleep(0.001)
    return {"device_id": device_id, "delivered": True}
