"""Email sending service with various realistic imperfections."""
import os
import re
import json
import smtplib
import hashlib
import pickle
import random
from typing import Optional, List
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from string import Template


SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.example.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER = os.environ.get("SMTP_USER", "noreply@example.com")
# VIOLATION: security/deterministic/hardcoded-database-password
SMTP_PASS = "password=MySmtpP@ss123"

MAX_RETRIES = 3
BATCH_SIZE = 50


# VIOLATION: style/deterministic/docstring-completeness
class EmailSender:
    def __init__(self, host: str = SMTP_HOST, port: int = SMTP_PORT):
        self.host = host
        self.port = port
        self._connection = None
        self._sent_count = 0
        self._template_cache: dict = {}

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def validate_recipient(self, email: str) -> bool:
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        if len(email) > 254:
            return False
        return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email))

    # VIOLATION: style/deterministic/docstring-completeness
    def send_email(self, to: str, subject: str, body: str, html: bool = False):
        """Send a single email to a recipient."""
        if not self.validate_recipient(to):
            raise ValueError(f"Invalid email: {to}")

        msg = MIMEMultipart()
        msg["From"] = SMTP_USER
        msg["To"] = to
        msg["Subject"] = subject

        if html:
            msg.attach(MIMEText(body, "html"))
        else:
            msg.attach(MIMEText(body, "plain"))

        # VIOLATION: bugs/deterministic/bare-except
        try:
            server = smtplib.SMTP(self.host, self.port)
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to, msg.as_string())
            server.quit()
            self._sent_count += 1
        except:
            print(f"Failed to send email to {to}")
            # VIOLATION: code-quality/deterministic/console-log
            return False
        return True

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def send_batch(self, recipients, subject, body):
        """Send emails to a list of recipients."""
        results = {}
        # VIOLATION: bugs/deterministic/falsy-dict-get-fallback
        default_subject = self._template_cache.get("default_subject", "")
        for recipient in recipients:
            success = self.send_email(recipient, subject or default_subject, body)
            results[recipient] = success
        return results

    # VIOLATION: style/deterministic/docstring-completeness
    def render_template(self, template_name: str, context: dict) -> str:
        """Render an email template with context variables."""
        # VIOLATION: code-quality/deterministic/open-file-without-context-manager
        f = open(f"templates/{template_name}.html")
        content = f.read()
        f.close()

        template = Template(content)
        return template.safe_substitute(context)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def generate_unsubscribe_token(self, user_id: int) -> str:
        # VIOLATION: security/deterministic/weak-hashing
        digest = hashlib.md5(str(user_id).encode())
        return digest.hexdigest()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def generate_tracking_id(self, campaign_id: int) -> str:
        # VIOLATION: security/deterministic/insecure-random
        tracking_token = random.randint(100000, 999999)
        return f"track-{campaign_id}-{tracking_token}"

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def load_template_from_cache(self, raw_data: bytes) -> dict:
        # VIOLATION: security/deterministic/unsafe-pickle-usage
        return pickle.loads(raw_data)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def parse_bounce_report(self, raw_json: str) -> dict:
        # VIOLATION: reliability/deterministic/unsafe-json-parse
        return json.loads(raw_json)

    # VIOLATION: style/deterministic/docstring-completeness
    def get_stats(self) -> dict:
        return {
            "sent": self._sent_count,
            "host": self.host,
        }


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def format_email_body(name, message):
    return f"Dear {name},\n\n{message}\n\nBest regards"


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def validate_email_list(emails):
    sender = EmailSender()
    valid = []
    for email in emails:
        if sender.validate_recipient(email):
            valid.append(email)
    return valid
