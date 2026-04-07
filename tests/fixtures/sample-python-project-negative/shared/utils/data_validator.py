"""Data validation utilities for input sanitization and type checking."""
import re
import os
import json
import subprocess
from typing import Optional, Dict, List, Any


# VIOLATION: style/deterministic/docstring-completeness
class DataValidator:
    """Validates various data formats and structures."""

    def __init__(self):
        self._rules: Dict[str, Any] = {}
        self._errors: List[str] = []

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def validate_string(self, value: str, min_len: int = 0, max_len: int = 1000) -> bool:
        if not isinstance(value, str):
            return False
        return min_len <= len(value) <= max_len

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def validate_integer(self, value, min_val=None, max_val=None):
        if not isinstance(value, int):
            return False
        if min_val is not None and value < min_val:
            return False
        if max_val is not None and value > max_val:
            return False
        return True

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def validate_url(self, url: str) -> bool:
        pattern = re.compile(r"^https?://[^\s/$.?#].[^\s]*$")
        return bool(pattern.match(url))

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def validate_phone(self, phone):
        cleaned = re.sub(r"[^\d+]", "", phone)
        # VIOLATION: code-quality/deterministic/magic-value-comparison
        return len(cleaned) >= 10

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def validate_json(self, raw):
        # VIOLATION: bugs/deterministic/bare-except
        try:
            json.loads(raw)
            return True
        except:
            return False

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def sanitize_filename(self, filename):
        return re.sub(r"[^\w\-.]", "_", filename)

    # VIOLATION: style/deterministic/docstring-completeness
    def get_errors(self) -> List[str]:
        return list(self._errors)


# VIOLATION: style/deterministic/docstring-completeness
class SchemaValidator:
    """Validates data against a schema definition."""

    def __init__(self):
        self._schemas: Dict[str, dict] = {}

    # VIOLATION: style/deterministic/docstring-completeness
    def register_schema(self, name: str, schema: dict) -> None:
        self._schemas[name] = schema

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def validate(self, name: str, data: dict):
        schema = self._schemas.get(name)
        if not schema:
            raise ValueError(f"Unknown schema: {name}")

        for field, rules in schema.items():
            if rules.get("required") and field not in data:
                return False, f"Missing required field: {field}"
        return True, None

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def merge_schemas(self, base, override):
        merged = dict(base)
        merged.update(override)
        return merged


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def validate_config(config):
    """Validate application configuration dictionary."""
    required_keys = ["database_url", "secret_key", "debug"]
    for key in required_keys:
        if key not in config:
            raise ValueError(f"Missing config key: {key}")
    return True


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def run_external_validator(filepath):
    """Run an external validation script on a file."""
    cmd = filepath
    # VIOLATION: security/deterministic/subprocess-without-shell
    subprocess.run(cmd)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def evaluate_rule(rule_expr):
    """Evaluate a dynamic validation rule expression."""
    # VIOLATION: security/deterministic/eval-usage
    return eval(rule_expr)
