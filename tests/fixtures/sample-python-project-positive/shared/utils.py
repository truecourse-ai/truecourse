"""General-purpose utility functions."""

from hashlib import sha256
from json import loads, JSONDecodeError
from time import time

HASH_TRUNCATION_LENGTH = 12


def generate_id(prefix: str, seed: str) -> str:
    """Generate a deterministic ID from a prefix and seed string.

    Args:
        prefix: A short prefix for the ID (e.g. 'usr', 'req').
        seed: Input string to hash for uniqueness.

    Returns:
        A prefixed hex ID string.
    """
    full_hex = sha256(seed.encode()).hexdigest()
    digest = full_hex[0:HASH_TRUNCATION_LENGTH]
    return f"{prefix}_{digest}"


def current_timestamp() -> float:
    """Return the current time as a Unix timestamp.

    Returns:
        Seconds since epoch as a float.
    """
    return time()


def safe_json_parse(raw: str) -> tuple:
    """Parse a JSON string, returning parsed data or an error message.

    Args:
        raw: The raw JSON string to parse.

    Returns:
        A tuple of (parsed_data, error_message).
        On success, error_message is empty. On failure, parsed_data is None.
    """
    try:
        parsed = loads(raw)
    except (JSONDecodeError, TypeError) as exc:
        msg = f"JSON parse failed for input length {len(raw)}: {exc}"
        return None, msg
    return parsed, ""


def clamp_value(value: float, low: float, high: float) -> float:
    """Clamp a numeric value to the given range.

    Args:
        value: The value to clamp.
        low: The minimum bound.
        high: The maximum bound.

    Returns:
        The clamped value within [low, high].
    """
    if value < low:
        return low
    if value > high:
        return high
    return value


def truncate_string(text: str, max_len: int) -> str:
    """Truncate a string to a maximum length, adding an ellipsis if needed.

    Args:
        text: The input text.
        max_len: Maximum length of the output string including ellipsis.

    Returns:
        The original string if short enough, or a truncated version.
    """
    if len(text) <= max_len:
        return text
    suffix = "..."
    end_pos = max_len - len(suffix)
    return text[0:end_pos] + suffix
