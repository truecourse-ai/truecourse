"""Data pipeline for ETL operations and data transformations."""
import os
import re
import json
import csv
import time
import logging
import sqlite3
import hashlib
import subprocess
from typing import Optional, Dict, List, Any, Callable
from datetime import datetime
from collections import deque
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
from string import Template
from itertools import starmap
from pathlib import Path


# ---- Duplicate dict key (constant key in comprehension) ----

# VIOLATION: bugs/deterministic/duplicate-dict-key
DEFAULT_CONFIG = {"batch_size": v for v in [100, 50]}


# ---- Mutable class default ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: bugs/deterministic/mutable-class-default
class PipelineState:
    errors = []
    warnings = []


# ---- Abstract class without abstract method ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/abstract-class-without-abstract-method
class BasePipeline(ABC):
    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def execute(self, data):
        return data


# ---- Deeply nested functions ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def create_transformer():
    # VIOLATION: code-quality/deterministic/deeply-nested-functions
    def outer():
        def middle():
            def inner():
                def deep():
                    return 1
                return deep
            return inner
        return middle
    return outer


# ---- Collapsible if ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def validate_record(record):
    # VIOLATION: code-quality/deterministic/collapsible-if
    if record.get("type"):
        if record.get("value"):
            return True
    return False


# ---- No empty function ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/no-empty-function
def placeholder_handler():
    pass


# ---- Unnecessary else after return ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def classify_value(x):
    # VIOLATION: code-quality/deterministic/unnecessary-else-after-return
    if x > 0:
        return "positive"
    else:
        return "non-positive"


# ---- Getattr with constant ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def get_name(obj):
    # VIOLATION: code-quality/deterministic/getattr-with-constant
    return getattr(obj, "name")


# ---- Collection literal concatenation ----

# VIOLATION: code-quality/deterministic/collection-literal-concatenation
combined = [1, 2] + [3, 4]

# ---- Enumerate for loop ----

items = [10, 20, 30]
# VIOLATION: code-quality/deterministic/enumerate-for-loop
for i in range(len(items)):
    pass

# ---- Unnecessary range start ----

# VIOLATION: code-quality/deterministic/unnecessary-range-start
for i in range(0, 10):
    pass


# ---- Import alias same name ----

# VIOLATION: code-quality/deterministic/useless-import-alias
import os as os


# ---- Set mutations in loop ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def build_unique_keys(items):
    # VIOLATION: performance/deterministic/set-mutations-in-loop
    result = set()
    for item in items:
        result.add(item)
    return result


# ---- Repeated append ----

# VIOLATION: code-quality/deterministic/repeated-append
columns = []
columns.append("id")
columns.append("name")
columns.append("email")


# ---- Unnecessary list cast ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def double_list(items):
    # VIOLATION: performance/deterministic/unnecessary-list-cast
    return list([x * 2 for x in items])


# ---- Str replace over re.sub ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def simple_replace(text):
    # VIOLATION: performance/deterministic/str-replace-over-re-sub
    return re.sub("hello", "world", text)


# ---- Empty deque ----

# VIOLATION: code-quality/deterministic/unnecessary-empty-iterable-in-deque
buffer = deque([])


# ---- Dict get none default ----

config = {"key": "value"}
# VIOLATION: code-quality/deterministic/dict-get-none-default
val = config.get("key", None)


# ---- Zip dict keys and values ----

mapping = {"a": 1, "b": 2}
# VIOLATION: code-quality/deterministic/zip-dict-keys-values
pairs = zip(mapping.keys(), mapping.values())


# ---- Unnecessary direct lambda call ----

# VIOLATION: code-quality/deterministic/unnecessary-direct-lambda-call
computed = (lambda x: x + 1)(5)


# ---- Unnecessary dunder call ----

# VIOLATION: code-quality/deterministic/unnecessary-dunder-call
length = [].__len__()


# ---- Sorted reversed redundant ----

data = [3, 1, 2]
# VIOLATION: code-quality/deterministic/sorted-reversed-redundant
ordered = reversed(sorted(data))


# ---- Redundant collection function ----

items_list = [5, 3, 1]
# VIOLATION: code-quality/deterministic/redundant-collection-function
sorted_items = list(sorted(items_list))


# ---- Startswith/endswith tuple ----

name = "hello"
# VIOLATION: code-quality/deterministic/startswith-endswith-tuple
if name.startswith("a") or name.startswith("b") or name.startswith("c"):
    pass


# ---- Pprint usage ----

import pprint
# VIOLATION: code-quality/deterministic/pprint-usage
pprint.pprint(DEFAULT_CONFIG)


# ---- Unnecessary cast to int ----

items_count = [1, 2, 3]
# VIOLATION: code-quality/deterministic/unnecessary-cast-to-int
count = int(len(items_count))


# ---- Unnecessary round ----

# VIOLATION: code-quality/deterministic/unnecessary-round
rounded = round(5)


# ---- Slice to remove prefix ----

prefix_str = "hello_world"
# VIOLATION: code-quality/deterministic/slice-to-remove-prefix-suffix
stripped = prefix_str[len("hello"):]


# ---- Read whole file ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def process_file(path):
    # VIOLATION: code-quality/deterministic/read-write-whole-file
    content = open(path).read()
    return content


# ---- Readlines in for ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def process_lines(path):
    # VIOLATION: code-quality/deterministic/readlines-in-for
    with open(path) as f:
        for line in f.readlines():
            pass


# ---- Subprocess patterns ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def run_script(script_path):
    # VIOLATION: code-quality/deterministic/subprocess-run-without-check
    subprocess.run(["python", script_path])


# ---- Private member access ----

# VIOLATION: style/deterministic/docstring-completeness
class DataStore:
    def __init__(self):
        self._data = {}

# VIOLATION: code-quality/deterministic/private-member-access
store = DataStore()
val = store._data


# ---- Non-augmented assignment ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def increment(counter):
    # VIOLATION: code-quality/deterministic/non-augmented-assignment
    counter = counter + 1
    return counter


# ---- Else on loop ----

# VIOLATION: code-quality/deterministic/useless-else-on-loop
for x in range(10):
    pass
else:
    pass


# ---- Suppressible exception ----

# VIOLATION: code-quality/deterministic/suppressible-exception
try:
    os.remove("temp.txt")
except FileNotFoundError:
    pass


# ---- Check and remove from set ----

s = {1, 2, 3}
# VIOLATION: code-quality/deterministic/check-and-remove-from-set
if 2 in s:
    s.remove(2)


# ---- Unnecessary key check ----

d = {"a": 1}
# VIOLATION: code-quality/deterministic/unnecessary-key-check
if "a" in d:
    del d["a"]


# ---- And/or ternary ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def legacy_ternary(flag, a, b):
    # VIOLATION: code-quality/deterministic/and-or-ternary
    return flag and a or b


# ---- Dict fromkeys for constant ----

keys = ["a", "b", "c"]
# VIOLATION: code-quality/deterministic/dict-fromkeys-for-constant
mapping_init = {k: 0 for k in keys}


# ---- Confusing implicit concat ----

# VIOLATION: bugs/deterministic/confusing-implicit-concat
names = [
    "alice"
    "bob",
    "charlie",
]


# ---- Constant condition ----

# VIOLATION: bugs/deterministic/constant-condition
def dead_branch():
    if False:
        pass


# ---- Fstring docstring ----

# VIOLATION: bugs/deterministic/fstring-docstring
def documented():
    f"""This docstring is an f-string for no reason."""
    pass


# ---- Boolean trap ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def connect_db(host, port, use_ssl):
    pass

# VIOLATION: code-quality/deterministic/boolean-trap
connect_db("localhost", 5432, True)


# ---- Open file without context manager ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def read_config_file(path):
    # VIOLATION: code-quality/deterministic/open-file-without-context-manager
    f = open(path)
    data = f.read()
    f.close()
    return data


# ---- Superfluous else ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def guard_clause(value):
    # VIOLATION: code-quality/deterministic/superfluous-else-after-control
    if value < 0:
        raise ValueError("Negative value")
    else:
        return value


# ---- Useless if else ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def boolean_check(value):
    # VIOLATION: code-quality/deterministic/useless-if-else
    if value:
        return True
    else:
        return False


# ---- Nested min/max ----

a, b, c = 1, 2, 3
# VIOLATION: code-quality/deterministic/nested-min-max
smallest = min(min(a, b), c)


# ---- Map int version parsing ----

version = "3.11.5"
# VIOLATION: code-quality/deterministic/map-int-version-parsing
major, minor, patch = map(int, version.split("."))


# ---- Unused variable ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def has_unused():
    # VIOLATION: code-quality/deterministic/unused-variable
    unused_var = 42
    return 0


# ---- Require await ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/require-await
async def no_await():
    return 42


# ---- Stop iteration in generator ----

# VIOLATION: style/deterministic/docstring-completeness
def gen():
    """Generator that misuses StopIteration."""
    yield 1
    # VIOLATION: code-quality/deterministic/stop-iteration-in-generator
    raise StopIteration()


# ---- Bad dunder method ----

# VIOLATION: style/deterministic/docstring-completeness
class BadDunder:
    # VIOLATION: code-quality/deterministic/bad-dunder-method-name
    def __hello__(self):
        pass


# ---- Naming conventions ----

# VIOLATION: style/deterministic/python-naming-convention
class my_pipeline:
    pass


# VIOLATION: style/deterministic/python-naming-convention
def ProcessData():
    pass


# ---- Comment tag formatting ----

# VIOLATION: style/deterministic/comment-tag-formatting
# TODO fix this data pipeline issue

# VIOLATION: style/deterministic/comment-tag-formatting
# FIXME


# ---- Implicit string concatenation ----

# VIOLATION: style/deterministic/implicit-string-concatenation
parts = ["hello" "world", "foo"]


# ---- Import formatting ----

x = 42
# VIOLATION: style/deterministic/import-formatting
import threading


# --- DB write pattern TPs (moved from synthetic batch files) ---
from sqlalchemy.orm import Session as _Session


# VIOLATION: performance/deterministic/batch-writes-in-loop
def save_all_records(session: _Session, records: list) -> None:
    """Individual session.add() in loop instead of bulk insert."""
    for record in records:
        session.add(record)
