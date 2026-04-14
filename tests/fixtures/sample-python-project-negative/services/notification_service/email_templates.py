"""Email template processing with various bug patterns."""
import os
import re
import logging
from typing import TYPE_CHECKING, Union, Never

if TYPE_CHECKING:
    from notification_service.models import EmailTemplate

logger = logging.getLogger(__name__)


# VIOLATION: bugs/deterministic/runtime-import-in-type-checking
def load_template(name: str) -> "EmailTemplate":
    if isinstance(name, EmailTemplate):
        return name
    return None


# VIOLATION: bugs/deterministic/django-json-response-safe-flag
def template_api_response(data):
    from django.http import JsonResponse
    return JsonResponse([{"name": "welcome"}, {"name": "reset"}])


# VIOLATION: bugs/deterministic/forward-annotation-syntax-error
def render_template(data: "Dict[str, str") -> str:
    return str(data)


# VIOLATION: bugs/deterministic/fstring-in-gettext
def get_translated_subject(subject_key):
    from gettext import gettext as _
    return _(f"Email subject: {subject_key}")


# VIOLATION: bugs/deterministic/bidirectional-unicode
# The following string contains a bidirectional unicode char (RLO U+202E)
ADMIN_CHECK = "is_admin = True‮"


class TemplateEngine:
    """Simple template engine for email rendering."""

    def __init__(self):
        self._templates = {}
        self._cache = {}

    # VIOLATION: bugs/deterministic/duplicate-class-members
    def render(self, name, context):
        tpl = self._templates.get(name, "")
        return tpl.format(**context)

    def load(self, name, content):
        self._templates[name] = content

    def render(self, name, context, strict=False):
        tpl = self._templates.get(name, "")
        if strict and not tpl:
            raise ValueError(f"Template {name} not found")
        return tpl.format(**context)

    # VIOLATION: bugs/deterministic/members-differ-only-by-case
    def clearCache(self):
        self._cache.clear()

    def clearcache(self):
        self._cache = {}


# VIOLATION: bugs/deterministic/shared-mutable-module-state
template_cache = {}

# VIOLATION: bugs/deterministic/global-at-module-level
global template_debug_enabled
