"""Shared validation utilities."""
import re


def validate_email(email):
    pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    return bool(re.match(pattern, email))


def validate_phone(phone):
    return bool(re.match(r"^\+?1?\d{9,15}$", phone))
