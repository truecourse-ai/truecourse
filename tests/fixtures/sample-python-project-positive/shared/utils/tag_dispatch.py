"""Magic-value-comparison Phase 3 coverage.

These patterns must NOT trigger magic-value-comparison:
  - Attribute operand provides context
  - Enum-like tag-dispatch strings
  - File extensions
  - HTTP methods
  - Subscript operand context

Zero violations expected.
"""


class Response:
    """Dummy response used in the fixture."""
    status_code: int = 0


class Request:
    """Dummy request used in the fixture."""
    method: str = ""


class Path:
    """Dummy path used in the fixture."""
    suffix: str = ""


class Event:
    """Dummy event used in the fixture."""
    kind: str = ""


def status_is_ok(response: Response) -> bool:
    """HTTP status code with attribute context is not a magic value."""
    return response.status_code == 200


def handle_method(request: Request) -> str:
    """HTTP method comparisons are idiomatic string literals."""
    if request.method == "GET":
        return "read"
    if request.method == "POST":
        return "write"
    return "other"


def classify_file(path: Path) -> str:
    """File extension comparisons are idiomatic string literals."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "document"
    if suffix == ".jpg":
        return "image"
    return "other"


def dispatch_event(event: Event) -> str:
    """Enum-like tag dispatch with attribute context."""
    if event.kind == "click":
        return "ui"
    if event.kind == "keypress":
        return "ui"
    if event.kind == "network_request":
        return "net"
    return "unknown"


def from_subscript(row: dict[str, int]) -> bool:
    """Subscript operand provides context, not a magic value."""
    return row["status"] == 200
