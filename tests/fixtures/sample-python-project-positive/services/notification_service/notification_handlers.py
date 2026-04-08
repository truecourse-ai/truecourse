"""Notification handlers for email, SMS, and push notifications."""
import logging
from string import Template

logger = logging.getLogger(__name__)

NOTIFICATION_TYPES = ["email", "sms", "push", "webhook"]


def send_notification(notification_type: str, recipient: str, message: str) -> bool:
    """Send a notification to a recipient via the specified channel."""
    handlers = {
        "email": send_email,
        "sms": send_sms,
        "push": send_push,
        "webhook": send_webhook,
    }
    handler = handlers.get(notification_type)
    if handler:
        return handler(recipient, message)
    return False


def render_notification(name: str, action: str) -> str:
    """Render a notification message using a template."""
    tmpl = Template("Hello $name, you $action your account")
    return tmpl.substitute(name=name, action=action)


def send_email(recipient: str, message: str) -> bool:
    """Send an email notification."""
    logger.info("Sending email to %s", recipient)
    return True


def send_sms(recipient: str, message: str) -> bool:
    """Send an SMS notification."""
    logger.info("Sending SMS to %s", recipient)
    return True


def send_push(recipient: str, message: str) -> bool:
    """Send a push notification."""
    logger.info("Sending push to %s", recipient)
    return True


def send_webhook(recipient: str, message: str) -> bool:
    """Send a webhook notification."""
    logger.info("Sending webhook to %s", recipient)
    return True
