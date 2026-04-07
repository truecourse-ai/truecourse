import re


def validate_email(email: str) -> bool:
    email_regex = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    return bool(re.match(email_regex, email))


def validate_name(name: str) -> bool:
    return 2 <= len(name) <= 100
