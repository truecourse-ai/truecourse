"""General helper utilities with various code patterns."""
import os
import re
import sys
import json
import time
import logging
import hashlib
import sqlite3
import subprocess
from typing import Optional, Dict, List, Any
from collections import deque
from pathlib import Path
from datetime import datetime


# VIOLATION: code-quality/deterministic/builtin-shadowing
filter = None

# VIOLATION: bugs/deterministic/unintentional-type-annotation
result: int


# ---- Mutable defaults and function patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: bugs/deterministic/mutable-default-arg
def collect_items(item, items=[]):
    items.append(item)
    return items


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: bugs/deterministic/mutable-default-arg
def build_config(overrides, base={}):
    base.update(overrides)
    return base


# ---- Boolean and comparison patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def is_valid_status(status):
    # VIOLATION: code-quality/deterministic/needless-bool
    return True if status > 0 else False


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def check_range(value):
    # VIOLATION: code-quality/deterministic/needless-bool
    return False if value < 0 else True


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def is_empty(collection):
    # VIOLATION: code-quality/deterministic/len-test
    if len(collection):
        return False
    return True


# ---- Idiom and simplification patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_default(d, key, default=None):
    # VIOLATION: code-quality/deterministic/in-dict-keys
    if key in d.keys():
        return d[key]
    return default


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def is_matching(value):
    # VIOLATION: code-quality/deterministic/yoda-condition
    if 42 == value:
        return True
    return False


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def check_empty_string(s):
    # VIOLATION: code-quality/deterministic/compare-to-empty-string
    if s == "":
        return True
    return False


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def manual_max_val(a, b):
    # VIOLATION: code-quality/deterministic/if-expr-min-max
    return a if a > b else b


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def double_negate(x):
    # VIOLATION: code-quality/deterministic/double-negation
    return not not x


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def neg_comp(a, b):
    # VIOLATION: code-quality/deterministic/negated-comparison
    return not a == b


# ---- Collection and iteration patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def build_result(items):
    """Build a list from items."""
    # VIOLATION: performance/deterministic/manual-list-comprehension
    result = []
    for item in items:
        result.append(item * 2)
    return result


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def has_positive(items):
    # VIOLATION: performance/deterministic/list-comprehension-in-any-all
    return any([x > 0 for x in items])


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_smallest(data):
    # VIOLATION: performance/deterministic/sorted-for-min-max
    return sorted(data)[0]


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def string_build(items):
    """Build a string from items - quadratic."""
    # VIOLATION: performance/deterministic/quadratic-list-summation
    result = ""
    for item in items:
        result += str(item)
    return result


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def dict_iteration(mapping):
    # VIOLATION: performance/deterministic/incorrect-dict-iterator
    for key in mapping.keys():
        # VIOLATION: code-quality/deterministic/console-log
        print(key, mapping[key])


# ---- File and path patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def read_entire_file(path):
    # VIOLATION: code-quality/deterministic/read-write-whole-file
    content = open(path).read()
    return content


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def build_path(base, name):
    # VIOLATION: code-quality/deterministic/prefer-pathlib
    return os.path.join(base, name)


# ---- Exception and error patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def risky_operation(data):
    # VIOLATION: code-quality/deterministic/broad-exception-raised
    raise Exception("something happened")


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def verbose_reraise():
    # VIOLATION: code-quality/deterministic/verbose-raise
    try:
        risky_operation(None)
    except ValueError as e:
        raise e


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def pointless_try():
    # VIOLATION: code-quality/deterministic/useless-try-except
    try:
        risky_operation(None)
    except ValueError:
        raise


# ---- Logging patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def log_with_format(value):
    # VIOLATION: code-quality/deterministic/logging-string-format
    logging.info("Value is: %s" % value)


# ---- Unnecessary patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def assign_and_return():
    # VIOLATION: code-quality/deterministic/unnecessary-assign-before-return
    result = compute_value()
    return result


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def non_augmented(x):
    # VIOLATION: code-quality/deterministic/non-augmented-assignment
    x = x + 1
    return x


# VIOLATION: code-quality/deterministic/unnecessary-pass
class EmptyDocstring:
    """A class that only has a docstring."""
    pass


# ---- Database patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_all_records(conn):
    # VIOLATION: database/deterministic/select-star
    return conn.execute("SELECT * FROM records").fetchall()


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def delete_all_records(conn):
    # VIOLATION: database/deterministic/unsafe-delete-without-where
    conn.execute("DELETE FROM records")


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def search_records(conn, name):
    # VIOLATION: security/deterministic/sql-injection
    conn.execute(f"SELECT * FROM records WHERE name = '{name}'")


# ---- Security patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def unsafe_deserialize(data):
    import pickle
    # VIOLATION: security/deterministic/unsafe-pickle-usage
    return pickle.loads(data)


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def run_command(cmd):
    # VIOLATION: security/deterministic/os-command-injection
    os.system(f"echo {cmd}")


# ---- Unvalidated data ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def save_user_data(db):
    from flask import request
    # VIOLATION: database/deterministic/unvalidated-external-data
    db.execute("INSERT INTO users VALUES (%s)", request.json)


def compute_value():
    """Helper function."""
    return 42


# --- General pattern TPs (moved from synthetic batch files) ---

# VIOLATION: bugs/deterministic/unintentional-type-annotation
def bad_annotation():
    """Bare type annotation with no value and no later assignment."""
    result: int
    return None


# VIOLATION: bugs/deterministic/loop-at-most-one-iteration
def always_returns_first(items: list):
    """Loop exits unconditionally on first iteration."""
    for item in items:
        return item


# VIOLATION: bugs/deterministic/nonlocal-without-binding
def outer_no_binding():
    """nonlocal references a variable that doesn't exist in enclosing scope."""
    def inner():
        nonlocal missing_var
        missing_var = 42
    return inner


# VIOLATION: code-quality/deterministic/redeclared-assigned-name
def wasted_assignment():
    """First assignment is immediately overwritten — value is lost."""
    x = compute_something()
    x = compute_something_else()
    return x


def compute_something():
    """Stand-in."""
    return 1


def compute_something_else():
    """Stand-in."""
    return 2
