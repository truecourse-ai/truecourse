"""Style violations: formatting, naming, and documentation."""
import os

# Import placed after non-import code
x = 42

# VIOLATION: style/deterministic/import-formatting
import sys


# VIOLATION: style/deterministic/python-naming-convention
class my_class:
    pass


# VIOLATION: style/deterministic/python-naming-convention
def ProcessData():
    pass


# VIOLATION: style/deterministic/python-naming-convention
def getData():
    pass


# VIOLATION: style/deterministic/docstring-completeness
def public_function(x, y):
    return x + y


# VIOLATION: style/deterministic/docstring-completeness
class PublicClass:
    def method(self):
        return 42


# VIOLATION: style/deterministic/comment-tag-formatting
# TODO fix this later


# VIOLATION: style/deterministic/comment-tag-formatting
# FIXME


# VIOLATION: style/deterministic/implicit-string-concatenation
items = ["hello" "world", "foo"]


# VIOLATION: style/deterministic/pytest-decorator-style
import pytest

@pytest.mark.parametrize
def test_missing_args():
    pass


# VIOLATION: style/deterministic/python-minor-style-preference
config = {
    "host": "localhost",
    "port": 8080,
    "debug": True
}


# VIOLATION: style/deterministic/whitespace-formatting
def mixed_indent():
	x = 1
        y = 2
