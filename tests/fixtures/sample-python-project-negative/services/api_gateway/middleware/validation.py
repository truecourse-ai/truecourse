"""Request validation middleware for the API gateway."""
import os
import re
import sys
import asyncio
import logging
import subprocess
from typing import Iterable, TYPE_CHECKING
from contextvars import ContextVar
from pathlib import Path
from itertools import groupby

if TYPE_CHECKING:
    from services.api_gateway.models import RequestSchema  # noqa

logger = logging.getLogger(__name__)

# VIOLATION: bugs/deterministic/mutable-contextvar-default
request_context: ContextVar = ContextVar("request_context", default={})


# VIOLATION: bugs/deterministic/assignment-to-os-environ
def reset_environment():
    os.environ = {"PATH": "/usr/bin", "HOME": "/root"}


# VIOLATION: bugs/deterministic/lowercase-environment-variable
def get_api_config():
    return os.environ.get("api_secret_key")


# VIOLATION: bugs/deterministic/invalid-envvar-value
def get_debug_mode():
    return os.getenv(True)


# VIOLATION: bugs/deterministic/subprocess-popen-preexec-fn
def run_validator_script(script_path):
    proc = subprocess.Popen(
        ["python", script_path],
        preexec_fn=os.setpgrp,
        stdout=subprocess.PIPE,
    )
    return proc.communicate()


# VIOLATION: bugs/deterministic/os-path-commonprefix-bug
def validate_path_security(user_path, allowed_base):
    prefix = os.path.commonprefix([user_path, allowed_base])
    if prefix != allowed_base:
        raise PermissionError("Access denied")
    return user_path


# VIOLATION: bugs/deterministic/invalid-pathlib-with-suffix
def normalize_upload_extension(file_path):
    return Path(file_path).with_suffix("json")


# VIOLATION: bugs/deterministic/regex-backreference-invalid
def validate_email_format(email):
    return re.match(r"([a-zA-Z]+)@([a-zA-Z]+)\.\3", email)


# VIOLATION: bugs/deterministic/regex-boundary-unmatchable
def validate_token_format(token):
    return re.match(r"$Bearer\s+[A-Za-z0-9]+", token)


# VIOLATION: bugs/deterministic/regex-group-reference-mismatch-python
def sanitize_input(text):
    return re.sub(r"([<>])", r"\2", text)


# VIOLATION: bugs/deterministic/regex-lookahead-contradictory
def validate_password_complexity(password):
    return re.search(r"(?=\d)(?!\d)", password)


# VIOLATION: bugs/deterministic/regex-possessive-always-fails
def match_repeated_chars(text):
    return re.search(r"a++a", text)


# VIOLATION: bugs/deterministic/empty-character-class
def strip_special_chars(text):
    return re.sub(r"[]", "", text)


# VIOLATION: bugs/deterministic/forward-annotation-syntax-error
def validate_schema(data: "Dict[str, str") -> bool:
    return bool(data)


# VIOLATION: bugs/deterministic/fstring-in-gettext
def get_error_message(field_name):
    from gettext import gettext as _
    return _(f"Field {field_name} is invalid")


# VIOLATION: bugs/deterministic/function-call-in-default-argument
def validate_field(value, validators=compile_validators()):
    for v in validators:
        v(value)


# VIOLATION: bugs/deterministic/loop-variable-overrides-iterator
def validate_all_fields(fields):
    for fields in range(len(fields)):
        pass


# VIOLATION: bugs/deterministic/loop-at-most-one-iteration
def find_first_invalid(items):
    for item in items:
        return item


# VIOLATION: bugs/deterministic/reuse-groupby-generator
def group_validation_errors(errors):
    for key, group in groupby(errors, key=lambda e: e.field):
        first_pass = list(group)
        second_pass = list(group)
        yield key, first_pass, second_pass


# VIOLATION: bugs/deterministic/iter-returns-iterable
class ValidationPipeline:
    def __iter__(self) -> Iterable[str]:
        return iter(self._validators)

    def __init__(self):
        self._validators = []


# VIOLATION: bugs/deterministic/iter-not-returning-iterator
class FieldIterator:
    def __iter__(self):
        return self._fields

    def __init__(self):
        self._fields = []


# VIOLATION: bugs/deterministic/item-operation-unsupported
def get_validation_step():
    result = 42[0]
    return result


# VIOLATION: bugs/deterministic/invalid-index-type
def get_field_at(fields):
    return fields[1.5]


# VIOLATION: bugs/deterministic/runtime-import-in-type-checking
def validate_request(data):
    if isinstance(data, RequestSchema):
        return True
    return False


# VIOLATION: bugs/deterministic/redefined-while-unused
import json
import json


# VIOLATION: bugs/deterministic/super-without-brackets
class ExtendedValidator:
    def validate(self):
        return super.validate()


def compile_validators():
    return []
