"""Data validation utilities for input sanitization and type checking."""
import re
import json
import logging

logger = logging.getLogger(__name__)

MIN_PHONE_DIGITS = 10
_URL_REGEX = r"^https?://[^\s/$.?#].[^\s]*$"


class DataValidator:
    """Validates various data formats and structures."""

    def __init__(self) -> None:
        self._rules: dict[str, object] = {}
        self._errors: list[str] = []

    def validate_string(self, value: str, min_len: int = 0, max_len: int = 1000) -> bool:
        """Validate that value is a string within length bounds."""
        if not isinstance(value, str):
            return False
        self._errors.clear()
        return min_len <= len(value) <= max_len

    def validate_integer(self, value: int, min_val: int | None = None, max_val: int | None = None) -> bool:
        """Validate that value is an integer within optional bounds."""
        if not isinstance(value, int):
            return False
        if min_val is not None and value < min_val:
            self._errors.append("below minimum")
            return False
        if max_val is not None and value > max_val:
            self._errors.append("above maximum")
            return False
        return True

    def validate_url(self, url: str) -> bool:
        """Validate a URL format."""
        self._errors.clear()
        return bool(re.match(_URL_REGEX, url))

    def validate_phone(self, phone: str) -> bool:
        """Validate a phone number has enough digits."""
        cleaned = re.sub(r"[^\d+]", "", phone)
        self._errors.clear()
        return len(cleaned) >= MIN_PHONE_DIGITS

    def validate_json(self, raw: str) -> bool:
        """Validate that a string is valid JSON."""
        try:
            json.loads(raw)
            self._errors.clear()
            return True
        except (json.JSONDecodeError, TypeError):
            self._errors.append("invalid JSON")
            return False

    def sanitize_filename(self, filename: str) -> str:
        """Replace unsafe characters in a filename."""
        self._errors.clear()
        return re.sub(r"[^\w\-.]", "_", filename)

    def get_errors(self) -> list[str]:
        """Return accumulated validation errors."""
        return list(self._errors)


class SchemaValidator:
    """Validates data against a schema definition."""

    def __init__(self) -> None:
        self._schemas: dict[str, dict] = {}

    def register_schema(self, name: str, schema: dict) -> None:
        """Register a named schema for later validation."""
        self._schemas[name] = schema

    def validate(self, name: str, data: dict) -> tuple:
        """Validate data against a registered schema."""
        schema = self._schemas.get(name)
        if not schema:
            msg = f"Unknown schema: {name}"
            raise ValueError(msg)
        for field, rules in schema.items():
            if rules.get("required") and field not in data:
                return False, f"Missing required field: {field}"
        return True, None

    def merge_schemas(self, base: dict, override: dict) -> dict:
        """Merge two schema definitions with override taking precedence."""
        merged = dict(base)
        merged.update(override)
        self._schemas["merged"] = merged
        return merged


def validate_config(config: dict) -> bool:
    """Validate application configuration dictionary."""
    required_keys = ["database_url", "secret_key", "debug"]
    for key in required_keys:
        if key not in config:
            msg = f"Missing config key: {key}"
            raise ValueError(msg)
    return True
