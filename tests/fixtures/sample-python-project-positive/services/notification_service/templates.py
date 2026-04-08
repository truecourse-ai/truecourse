"""Template rendering engine for notification messages."""
import re
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_LOCALE = "en"
locale_setting: str = DEFAULT_LOCALE
template_dir_setting: str = "templates"

_re_compile = re.compile


class TemplateEngine:
    """Renders notification templates with variable substitution."""

    def __init__(self, template_dir: str = "templates") -> None:
        self.template_dir = template_dir
        self._cache: dict[str, str] = {}
        self._compiled: dict[str, object] = {}

    def load_template(self, name: str) -> str:
        """Load a template from disk or cache."""
        if name in self._cache:
            return self._cache[name]
        path = Path(self.template_dir) / f"{name}.html"
        with open(path, encoding="utf-8") as f:
            content = f.read()
        self._cache[name] = content
        return content

    def render(self, name: str, context: dict) -> str:
        """Render a template with the given context variables."""
        template = self.load_template(name)
        replacements = [(f"{{{{{k}}}}}", str(v)) for k, v in context.items()]
        for placeholder, replacement in replacements:
            template = template.replace(placeholder, replacement)
        return template

    def build_template_pattern(self, name: str) -> re.Pattern:
        """Build a template pattern for repeated use."""
        template = self.load_template(name)
        pattern = _re_compile(re.escape(template))
        self._compiled[name] = pattern
        return pattern

    def clear_cache(self) -> None:
        """Clear the template cache."""
        self._cache.clear()
        self._compiled.clear()


def format_currency(value: float, currency: str = "USD") -> str:
    """Format a numeric value as currency."""
    return f"{currency} {value:,.2f}"


def truncate_text(text: str, max_length: int = 100) -> str:
    """Truncate text to a maximum length with ellipsis."""
    if len(text) <= max_length:
        return text
    return text[:max_length - 1] + "..."
