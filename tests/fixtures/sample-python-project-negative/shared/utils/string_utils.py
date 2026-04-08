"""String utility functions with various bug patterns."""
import os
import re
import sys
import logging
from typing import Union, Never

logger = logging.getLogger(__name__)


# VIOLATION: bugs/deterministic/duplicate-args
def format_string(text, prefix, text):
    return f"{prefix}: {text}"


# VIOLATION: bugs/deterministic/duplicate-else-if
def classify_string(s):
    if len(s) == 0:
        return "empty"
    elif len(s) < 10:
        return "short"
    elif len(s) == 0:
        return "empty"
    else:
        return "long"


# VIOLATION: bugs/deterministic/duplicate-entry-dunder-all
__all__ = [
    "format_string",
    "classify_string",
    "format_string",
]


# VIOLATION: bugs/deterministic/duplicate-import
import json
import json


# VIOLATION: bugs/deterministic/never-union
def parse_or_fail(text: str) -> Union[dict, Never]:
    return json.loads(text)


# VIOLATION: bugs/deterministic/not-implemented-in-bool-context
class StringProcessor:
    def is_ready(self):
        if NotImplemented:
            return True
        return False


# VIOLATION: bugs/deterministic/not-in-operator-incompatible
def check_char_in_int(c):
    if c in 100:
        return True
    return False


# VIOLATION: bugs/deterministic/unreliable-callable-check
def apply_transform(fn):
    if hasattr(fn, "__call__"):
        return fn("test")
    return None


# VIOLATION: bugs/deterministic/unnecessary-equality-check
def is_same_string(a, b):
    return 42 == "42"


# VIOLATION: bugs/deterministic/unreliable-sys-version-check
def requires_python3():
    if sys.version[0] == "3":
        return True
    return False


# VIOLATION: bugs/deterministic/named-expr-without-context
(parsed := "hello")


# VIOLATION: bugs/deterministic/non-iterable-unpacking
def split_code():
    a, b = 404


# VIOLATION: bugs/deterministic/self-or-cls-assignment
class TextFormatter:
    def format(self, text):
        self = TextFormatter()
        return text.upper()


# VIOLATION: bugs/deterministic/super-without-brackets
class AdvancedFormatter(TextFormatter):
    def format(self, text):
        return super.format(text)


# VIOLATION: bugs/deterministic/invalid-special-method-return-type
class StringCollection:
    def __len__(self):
        return "many"

    def __bool__(self):
        return 1

    def __str__(self):
        return 42

    def __init__(self):
        self._items = []


# VIOLATION: bugs/deterministic/iter-not-returning-iterator
class CharIterator:
    def __iter__(self):
        return self._chars

    def __init__(self, text):
        self._chars = list(text)


# VIOLATION: bugs/deterministic/iter-returns-iterable
from typing import Iterable


class WordStream:
    def __iter__(self) -> Iterable[str]:
        return iter(self._words)

    def __init__(self):
        self._words = []


# VIOLATION: bugs/deterministic/item-operation-unsupported
def index_into_none():
    value = None[0]
    return value


# VIOLATION: bugs/deterministic/invalid-index-type
def get_char_at(text):
    return text[3.14]


# VIOLATION: bugs/deterministic/access-annotations-from-class-dict
class FormattedString:
    text: str
    encoding: str


def get_format_hints():
    return FormattedString.__dict__.get("__annotations__")


# VIOLATION: bugs/deterministic/yield-in-init
class LazyString:
    def __init__(self, parts):
        self.parts = parts
        yield from parts
