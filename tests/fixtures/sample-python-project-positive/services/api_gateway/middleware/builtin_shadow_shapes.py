"""builtin-shadowing shapes that should NOT fire.

Names like ``credits``, ``copyright``, ``license``, ``help``, ``quit``,
``exit`` are interactive-prompt convenience aliases injected by
``site.py`` — they are not in ``builtins.__dict__`` from a script's
point of view and shadowing them is harmless.
"""


def consume_credits(user_id: str, credits: int) -> int:
    """Return remaining credits after consumption."""
    return credits - 1


def show_copyright(year: int) -> str:
    """Return the application copyright string."""
    copyright = "(c) Acme Corp"
    return f"{copyright} {year}"


def show_license(short: bool) -> str:
    """Return the application license string."""
    license = "Apache-2.0"
    return license if short else f"License: {license}"
