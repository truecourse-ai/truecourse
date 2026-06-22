"""Customer notification delivery."""

from typing import Literal

from app.config_dsl import Selector

# Channels the platform can notify customers on. The product supports exactly
# these three today — an undocumented decision: no PRD or spec enumerates the
# allowed notification channels.
NotificationChannel = Literal["email", "sms", "push"]


# Notification transport selection. Exactly one transport is configured per
# delivery, so the closed set is a config-schema Selector union (its keys are
# transports). This is a DIFFERENT closed set from any receipt-status family.
NOTIFICATION_TRANSPORT_SCHEMA = {
    "transport": Selector(
        {
            "smtp_relay": {"host": str},
            "sms_gateway": {"account_sid": str},
            "push_service": {"app_id": str},
        }
    ),
}


# IL-DRIFT: Enum:DeliveryReceiptStatus / enum.DeliveryReceiptStatus.no-code-counterpart
# DeliveryReceiptStatus is documented with [queued, sent, bounced], but receipt
# tracking is delegated entirely to the downstream transport provider — there is
# no code-side enum or config-schema for it here, so the documented status set
# genuinely has no code counterpart. The transport Selector above is an unrelated
# closed set (transports, not statuses) and must NOT be mistaken for it.
def notify(channel: NotificationChannel, customer_id: str, message: str) -> None:
    """Enqueue a transactional notification.

    Delivery happens out-of-process; here we only validate the channel and
    hand the payload to the channel-specific topic.
    """
    _ = (channel, customer_id, message)
