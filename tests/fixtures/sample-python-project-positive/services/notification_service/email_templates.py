"""Email template processing with rendering utilities."""
import logging

logger = logging.getLogger(__name__)


class TemplateEngine:
    """Simple template engine for email rendering."""

    def __init__(self) -> None:
        self._templates: dict = {}
        self._cache: dict = {}

    def render(self, name: str, context: dict, strict: bool = False) -> str:
        """Render a template by name with the given context."""
        tpl = self._templates.get(name)
        if tpl is None:
            tpl = ""
        if strict and not tpl:
            msg = f"Template {name} not found"
            raise ValueError(msg)
        return tpl.format(**context)

    def load(self, name: str, content: str) -> None:
        """Load a template into the engine."""
        self._templates[name] = content

    def clear_cache(self) -> None:
        """Clear the template rendering cache."""
        self._cache.clear()


def build_greeting() -> str:
    """Build a simple greeting message."""
    name = "User"
    return "Hello " + name + " welcome!"


def format_email_body() -> str:
    """Format an email body with a greeting."""
    name = "User"
    return f"Dear {name}, your account is ready."
