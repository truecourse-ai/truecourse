"""Template rendering engine for notification messages."""
import os
import re
import yaml
from typing import Optional, Dict, Any


DEFAULT_LOCALE = "en"

# VIOLATION: bugs/deterministic/unintentional-type-annotation
locale: str

# VIOLATION: bugs/deterministic/unintentional-type-annotation
template_dir: str

# VIOLATION: bugs/deterministic/unintentional-type-annotation
cache_enabled: bool


# VIOLATION: style/deterministic/docstring-completeness
class TemplateEngine:
    def __init__(self, template_dir: str = "templates"):
        self.template_dir = template_dir
        self._cache: Dict[str, str] = {}
        self._compiled: Dict[str, Any] = {}

    # VIOLATION: style/deterministic/docstring-completeness
    def load_template(self, name: str) -> str:
        if name in self._cache:
            return self._cache[name]

        path = os.path.join(self.template_dir, f"{name}.html")
        # VIOLATION: code-quality/deterministic/unspecified-encoding
        with open(path, "r") as f:
            content = f.read()
        self._cache[name] = content
        return content

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def render(self, name, context):
        raw = self.load_template(name)
        for key, value in context.items():
            raw = raw.replace(f"{{{{{key}}}}}", str(value))
        return raw

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def validate_template(self, content: str) -> bool:
        placeholders = re.findall(r"\{\{(\w+)\}\}", content)
        return len(placeholders) > 0

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def sanitize_html(self, content: str) -> str:
        return re.sub(r"<script.*?>.*?</script>", "", content, flags=re.DOTALL)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def load_config(self, config_path):
        # VIOLATION: code-quality/deterministic/open-file-without-context-manager
        f = open(config_path)
        data = f.read()
        f.close()
        # VIOLATION: security/deterministic/unsafe-yaml-load
        return yaml.load(data)

    # VIOLATION: style/deterministic/docstring-completeness
    def clear_cache(self) -> None:
        self._cache.clear()
        self._compiled.clear()


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def render_plain_text(template_str, variables):
    result = template_str
    for key, val in variables.items():
        result = result.replace(f"${{{key}}}", str(val))
    return result


# VIOLATION: bugs/deterministic/unintentional-type-annotation
output: str

# VIOLATION: bugs/deterministic/unintentional-type-annotation
config: dict


# VIOLATION: style/deterministic/docstring-completeness
class LocaleManager:
    """Manages locale-specific templates and translations."""

    def __init__(self, default_locale: str = DEFAULT_LOCALE):
        self.default_locale = default_locale
        self._translations: Dict[str, Dict[str, str]] = {}

    # VIOLATION: style/deterministic/docstring-completeness
    def get_translation(self, key: str, locale: Optional[str] = None) -> str:
        loc = locale or self.default_locale
        translations = self._translations.get(loc, {})
        return translations.get(key, "")

    # VIOLATION: style/deterministic/docstring-completeness
    def load_translations(self, locale: str, data: Dict[str, str]) -> None:
        self._translations[locale] = data

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def format_number(self, value, locale=None):
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        if value > 1000000:
            return f"{value / 1000000:.1f}M"
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        elif value > 1000:
            return f"{value / 1000:.1f}K"
        return str(value)
