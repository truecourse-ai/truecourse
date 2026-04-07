"""Shared formatting utilities."""


def format_currency(amount):
    return f"${amount:.2f}"


def format_date(dt):
    return dt.strftime("%Y-%m-%d")
