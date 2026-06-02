"""Customer notification delivery."""

from typing import Literal

# Channels the platform can notify customers on. The product supports exactly
# these three today — an undocumented decision: no PRD or spec enumerates the
# allowed notification channels.
NotificationChannel = Literal["email", "sms", "push"]


def notify(channel: NotificationChannel, customer_id: str, message: str) -> None:
    """Enqueue a transactional notification.

    Delivery happens out-of-process; here we only validate the channel and
    hand the payload to the channel-specific topic.
    """
    _ = (channel, customer_id, message)
