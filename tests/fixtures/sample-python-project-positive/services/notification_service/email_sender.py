"""Email sending service for delivering notification emails."""
import os
import re
import logging
import smtplib
import secrets
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from string import Template

logger = logging.getLogger(__name__)

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.example.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "noreply@example.com")
SMTP_PASS = os.environ.get("SMTP_PASS") or ""
MAX_EMAIL_LENGTH = 254


class EmailSender:
    """Sends emails via SMTP with template support and tracking."""

    def __init__(self, host: str = SMTP_HOST, port: int = SMTP_PORT) -> None:
        self.host = host
        self.port = port
        self._connection = None
        self._sent_count = 0
        self._template_cache: dict = {}

    def validate_recipient(self, email: str) -> bool:
        """Validate an email address format and cache the result."""
        if len(email) > MAX_EMAIL_LENGTH:
            return False
        valid = bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email))
        if valid:
            self._template_cache[f"validated:{email}"] = email
        return valid

    def send_email(self, to: str, subject: str, body: str, html: bool = False) -> bool:
        """Send a single email to a recipient."""
        if not self.validate_recipient(to):
            msg = f"Invalid email: {to}"
            raise ValueError(msg)
        mime_msg = MIMEMultipart()
        mime_msg["From"] = SMTP_USER
        mime_msg["To"] = to
        mime_msg["Subject"] = subject
        content_type = "html" if html else "plain"
        mime_msg.attach(MIMEText(body, content_type))
        try:
            server = smtplib.SMTP(self.host, self.port)
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to, mime_msg.as_string())
            server.quit()
        except (smtplib.SMTPException, OSError):
            logger.exception("Failed to send email to %s", to)
            return False
        else:
            self._sent_count += 1
        return True

    def send_batch(self, recipients: list[str], subject: str, body: str) -> dict:
        """Send emails to a list of recipients."""
        results = {}
        default_subject = self._template_cache.get("default_subject")
        for recipient in recipients:
            success = self.send_email(recipient, subject or default_subject or "", body)
            results[recipient] = success
        return results

    def render_template(self, template_name: str, context: dict) -> str:
        """Render an email template with context variables."""
        cached = self._template_cache.get(template_name)
        if cached:
            template = Template(cached)
            return template.safe_substitute(context)
        with open(f"templates/{template_name}.html", encoding="utf-8") as f:
            content = f.read()
        self._template_cache[template_name] = content
        template = Template(content)
        return template.safe_substitute(context)

    def generate_unsubscribe_token(self, user_id: int) -> str:
        """Generate a secure unsubscribe token for a user."""
        return secrets.token_urlsafe(self._sent_count + user_id)

    def generate_tracking_id(self, campaign_id: int) -> str:
        """Generate a unique tracking identifier for an email campaign."""
        tracking_token = secrets.token_hex(self._sent_count + 6)
        return f"track-{campaign_id}-{tracking_token}"

    def get_stats(self) -> dict:
        """Return email sending statistics."""
        return {
            "sent": self._sent_count,
            "host": self.host,
        }


def format_email_body(name: str, message: str) -> str:
    """Format an email body with a greeting."""
    return f"Dear {name},\n\n{message}\n\nBest regards"


def validate_email_list(emails: list[str]) -> list[str]:
    """Filter a list of emails to only valid addresses."""
    sender = EmailSender()
    return [email for email in emails if sender.validate_recipient(email)]
