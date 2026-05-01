"""Input validation utilities."""
import re

MIN_NAME_LENGTH = 2
MAX_NAME_LENGTH = 100

# Case-insensitive header match using Python's inline-flag syntax.
HEADER_RE = re.compile(r"(?i)content-type\s*:\s*([\w/+.-]+)")

# Inline-flag scoped group: case-insensitive only inside the group.
PROTOCOL_RE = re.compile(r"^(?i:https?)://([\w.-]+)")

# Python named group syntax.
DATE_RE = re.compile(r"(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})")

# Named backreference: open and close quote must match.
BALANCED_QUOTE_RE = re.compile(r"(?P<q>['\"])[\w\s]+(?P=q)")

# DOTALL flag (`(?s)`) makes `.` span newlines. The non-greedy `.*?` is the
# canonical way to match across multiple lines without consuming the
# terminator - `[^x]*` doesn't work because there's no single stop char and
# DOTALL deliberately allows newlines through. The `regex-char-class-preferred`
# detector must skip `.*?` / `.+?` when the pattern is in DOTALL mode.
COMMENT_BLOCK_RE = re.compile(r"(?s)/\*.*?\*/")
SCRIPT_TAG_RE = re.compile(r"(?is)<script\b[^>]*>.*?</script>")


def validate_email(email: str) -> bool:
    """Validate an email address format using a simple regex."""
    email_regex = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    return bool(re.match(email_regex, email))


def validate_name(name: str) -> bool:
    """Validate a name meets length requirements."""
    name_len = len(name)
    return name_len >= MIN_NAME_LENGTH and name_len <= MAX_NAME_LENGTH


def parse_content_type(header: str) -> str | None:
    """Extract content-type value from an HTTP header line."""
    match = HEADER_RE.search(header)
    return match.group(1) if match else None


def parse_protocol_host(url: str) -> str | None:
    """Pull the host portion from an http(s) URL using a scoped flag group."""
    match = PROTOCOL_RE.match(url)
    return match.group(1) if match else None


def parse_iso_date(text: str) -> tuple[str, str, str] | None:
    """Pull year/month/day from an ISO date in `text`."""
    match = DATE_RE.search(text)
    if not match:
        return None
    return match.group("year"), match.group("month"), match.group("day")
