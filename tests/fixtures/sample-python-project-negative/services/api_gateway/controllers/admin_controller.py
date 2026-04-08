"""Admin controller for managing system configuration and Django models."""
import os
import re
import sys
import logging
import typing
from typing import Optional, Dict, List, Any, Union, TYPE_CHECKING

logger = logging.getLogger(__name__)


# VIOLATION: code-quality/deterministic/legacy-type-hint-syntax
def get_admin_users() -> typing.List[str]:
    return ["admin1", "admin2"]


# VIOLATION: code-quality/deterministic/future-annotations-import
def process_value(x) -> int | str:
    pass


# VIOLATION: code-quality/deterministic/duplicate-string
def build_admin_report() -> dict:
    """Build an admin report with common labels."""
    report = {}
    report["section_a"] = "admin_dashboard_report"
    report["section_b"] = "admin_dashboard_report"
    report["section_c"] = "admin_dashboard_report"
    report["section_d"] = "admin_dashboard_report"
    return report


# VIOLATION: code-quality/deterministic/implicit-string-concatenation
ADMIN_ROLES = [
    "super_admin",
    "moderator"
    "viewer",
    "editor",
]


# VIOLATION: code-quality/deterministic/redeclared-assigned-name
def configure_admin(env: str) -> dict:
    timeout = 30
    timeout = 60
    return {"timeout": timeout, "env": env}


# SKIP: code-quality/deterministic/redefined-loop-name
# Reason: Visitor's findAssignments checks for direct 'assignment' children of the block,
# but tree-sitter Python wraps them in 'expression_statement'. Visitor cannot match.
def process_admin_configs(configs: List[dict]) -> List[str]:
    results = []
    for config in configs:
        config = config.get("name", "default")
        results.append(config)
    return results


# VIOLATION: code-quality/deterministic/return-not-implemented
class AdminAction:
    def __eq__(self, other) -> Any:
        raise NotImplementedError("not supported")


# VIOLATION: code-quality/deterministic/return-type-inconsistent-with-hint
def get_admin_count() -> int:
    return "two"


# VIOLATION: code-quality/deterministic/reimplemented-container-builtin
empty_list_factory = lambda: []


# VIOLATION: code-quality/deterministic/reimplemented-operator
add_values = lambda a, b: a + b


# VIOLATION: code-quality/deterministic/python-idiom-simplification
def clear_admin_cache(cache: list) -> None:
    del cache[:]


# VIOLATION: code-quality/deterministic/raw-string-in-exception
def validate_admin_email(email: str) -> None:
    if "@" not in email:
        raise ValueError(r"Invalid email: must contain \@ symbol")


# VIOLATION: code-quality/deterministic/raise-within-try
def process_admin_request(data: dict) -> dict:
    try:
        raise KeyError("Missing action")
    except KeyError:
        return {"status": "error"}


# VIOLATION: code-quality/deterministic/starmap-zip-simplification
from itertools import starmap

def combine_names_scores(names: list, scores: list) -> list:
    return list(starmap(lambda n, s: f"{n}:{s}", zip(names, scores)))


# VIOLATION: code-quality/deterministic/zip-instead-of-pairwise
def pairwise_diff(values: List[float]) -> List[float]:
    return [b - a for a, b in zip(values, values[1:])]


# --- Django Model violations ---

from django.db import models
from django import forms
from django.shortcuts import render
from django.dispatch import receiver
from django.db.models.signals import post_save


# VIOLATION: code-quality/deterministic/django-model-without-str
class AuditLog(models.Model):
    action = models.CharField(max_length=100)
    user_id = models.IntegerField()
    timestamp = models.DateTimeField(auto_now_add=True)


# VIOLATION: code-quality/deterministic/django-nullable-string-field
class AdminProfile(models.Model):
    name = models.CharField(max_length=100)
    bio = models.CharField(max_length=500, null=True)

    def __str__(self):
        return self.name


# SKIP: code-quality/deterministic/django-model-form-fields
# Reason: Visitor iterates Meta body looking for 'assignment' nodes but tree-sitter wraps
# them in 'expression_statement'. Visitor cannot match the fields = '__all__' pattern.
class AuditLogForm(forms.ModelForm):
    class Meta:
        model = AuditLog
        fields = '__all__'


# VIOLATION: code-quality/deterministic/django-locals-in-render
def admin_dashboard(request):
    title = "Admin Dashboard"
    metrics = {"users": 100, "requests": 5000}
    return render(request, "admin/dashboard.html", locals())


# VIOLATION: code-quality/deterministic/django-receiver-decorator-order
class AuditLogHandler:
    @staticmethod
    @receiver(post_save, sender=AuditLog)
    def on_audit_created(sender, instance, **kwargs):
        logger.info(f"Audit log created: {instance.action}")


# VIOLATION: code-quality/deterministic/django-unordered-body-content
class SystemConfig(models.Model):
    key = models.CharField(max_length=100)
    value = models.TextField()

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)

    class Meta:
        ordering = ["key"]

    def __str__(self):
        return self.key


# --- Type checking violations ---

# VIOLATION: code-quality/deterministic/empty-type-checking-block
if TYPE_CHECKING:
    pass


# VIOLATION: code-quality/deterministic/typing-only-import
from dataclasses import dataclass


# VIOLATION: code-quality/deterministic/type-checking-alias-annotation
if TYPE_CHECKING:
    from typing import TypeAlias
    AdminId: TypeAlias = Union[int, str]


def get_admin_by_id(admin_id: "AdminId") -> Optional[dict]:
    return None


# VIOLATION: code-quality/deterministic/unnecessary-type-union
def process_types(value: type[int] | type[str]) -> None:
    pass


# VIOLATION: code-quality/deterministic/unused-annotation
def compute_stats(data: list) -> dict:
    result: int
    total = sum(data)
    return {"total": total}


# VIOLATION: code-quality/deterministic/unused-unpacked-variable
def get_primary_admin(admins: list) -> str:
    name, role, email = admins[0]
    return name


# SKIP: code-quality/deterministic/no-explicit-any
# Reason: Visitor checks for 'type' node with parent of type 'type', but tree-sitter Python
# never creates this nesting. The parent of a type annotation node is typed_parameter,
# function_definition, or type_parameter - never another 'type' node.
def handle_unknown(data: Any) -> Any:
    return data


# VIOLATION: code-quality/deterministic/system-exit-not-reraised
def handle_shutdown():
    try:
        sys.exit(0)
    except SystemExit:
        logger.info("Caught exit, cleaning up")
