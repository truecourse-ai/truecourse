"""Additional code patterns covering more analyzer rules."""
import os
import re
import sys
import json
import time
import asyncio
import logging
import hashlib
import contextlib
from typing import Optional, Dict, List, Any, TypeVar
from typing import Union, Literal
from dataclasses import dataclass
from abc import ABC, abstractmethod
from enum import Enum
from collections import deque
from functools import lru_cache


# ---- Type patterns ----

# VIOLATION: code-quality/deterministic/any-type-hint
def flexible(x: Any):
    return x


# VIOLATION: code-quality/deterministic/blanket-type-ignore
result = None  # type: ignore


# VIOLATION: code-quality/deterministic/isinstance-type-none
def check_none_type(x):
    return isinstance(x, type(None))


# VIOLATION: code-quality/deterministic/confusing-type-check
def bad_type_check(x):
    if type(x) == int:
        return True


# VIOLATION: code-quality/deterministic/type-check-without-type-error
def strict_type(x):
    if not isinstance(x, str):
        raise ValueError("expected string")


# VIOLATION: code-quality/deterministic/generic-type-unparameterized
def get_items() -> List:
    return [1, 2, 3]


# ---- Legacy TypeVar ----

# VIOLATION: code-quality/deterministic/legacy-generic-syntax
T = TypeVar('T')


# ---- Class patterns ----

# VIOLATION: code-quality/deterministic/self-first-argument
class BadSelf:
    def method(this):
        return this


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/property-with-parameters
class PropParams:
    @property
    def value(self, extra=None):
        return self._value


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/field-duplicates-class-name
class User:
    User = None


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/duplicate-class-field
class DupField:
    x = 1
    x = 2


# ---- Exception patterns ----

# VIOLATION: code-quality/deterministic/bare-raise-outside-except
def bad_raise():
    raise


# ---- Function patterns ----

# VIOLATION: bugs/deterministic/instance-method-missing-self
class MissingSelfClass:
    def process():
        return "data"


# VIOLATION: bugs/deterministic/unexpected-special-method-signature
class BadLen:
    def __len__(self, other):
        return 0


# VIOLATION: bugs/deterministic/exit-method-wrong-signature
class BadContext:
    def __exit__(self):
        pass


# VIOLATION: bugs/deterministic/bad-staticmethod-argument
class BadStatic:
    @staticmethod
    def process(self, data):
        return data


# VIOLATION: bugs/deterministic/classmethod-first-argument-naming
class BadClassmethod:
    @classmethod
    def create(self):
        return self()


# ---- Hashable patterns ----

# VIOLATION: bugs/deterministic/hashable-set-dict-member
bad_set = {[1, 2], "ok"}


# ---- Single string slots ----

# VIOLATION: bugs/deterministic/single-string-slots
class StringSlots:
    __slots__ = "name"


# ---- Non slot assignment ----

# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: bugs/deterministic/non-slot-assignment
class Slotted:
    __slots__ = ("x", "y")
    def __init__(self):
        self.z = 3


# ---- Loop patterns ----

# VIOLATION: bugs/deterministic/modified-loop-iterator
def modify_while_iterating():
    items = [1, 2, 3, 4, 5]
    for item in items:
        if item == 3:
            items.remove(item)


# ---- Regex patterns ----

# VIOLATION: bugs/deterministic/regex-invalid-python
invalid_regex = re.compile(r"(unclosed")

# VIOLATION: bugs/deterministic/regex-empty-alternative-python
empty_alt = re.compile(r"foo|")

# VIOLATION: bugs/deterministic/regex-alternatives-redundant
redundant = re.compile(r"abc|abc")

# VIOLATION: bugs/deterministic/re-sub-positional-args
re.sub(r"\d+", "num", "abc123", re.IGNORECASE)


# ---- String patterns ----

# VIOLATION: bugs/deterministic/bad-string-format-character
bad_format = "value: %z" % 42

# VIOLATION: bugs/deterministic/string-format-mismatch
format_mismatch = "Hello %s, you are %d" % ("Alice",)

# VIOLATION: bugs/deterministic/strip-with-multi-chars
cleaned = "hello".strip("helo")


# ---- Comparison patterns ----

# VIOLATION: bugs/deterministic/is-literal-comparison
def check_literal(x):
    if x is "hello":
        return True


# VIOLATION: bugs/deterministic/none-comparison
def check_none(x):
    if x == None:
        return True


# VIOLATION: bugs/deterministic/type-comparison
def type_check(x):
    if type(x) == int:
        return True


# VIOLATION: bugs/deterministic/float-equality-comparison
def float_check(x):
    if x == 0.1:
        return True


# VIOLATION: bugs/deterministic/nan-comparison
import math
def nan_check(x):
    if x == float("nan"):
        return True


# ---- Assert patterns ----

# VIOLATION: bugs/deterministic/assert-on-tuple
assert (1, 2)

# VIOLATION: bugs/deterministic/assert-false
assert False

# VIOLATION: bugs/deterministic/assert-on-string-literal
assert "this is always true"


# ---- Exception handling patterns ----

# VIOLATION: bugs/deterministic/empty-catch
try:
    open("file.txt")
except FileNotFoundError:
    pass


# VIOLATION: bugs/deterministic/exception-not-from-base-exception
class MyError(str):
    pass


# VIOLATION: bugs/deterministic/binary-op-exception
try:
    pass
except ValueError or TypeError:
    pass


# VIOLATION: bugs/deterministic/redundant-tuple-in-exception
try:
    pass
except (ValueError,):
    pass


# VIOLATION: bugs/deterministic/duplicate-handler-exception
try:
    pass
except (ValueError, ValueError):
    pass


# VIOLATION: bugs/deterministic/useless-exception-statement
def bad_exception():
    ValueError("error")


# ---- Async patterns ----

# VIOLATION: bugs/deterministic/asyncio-dangling-task
async def fire_and_forget():
    asyncio.create_task(asyncio.sleep(1))


# VIOLATION: bugs/deterministic/blocking-call-in-async
async def blocking_in_async():
    time.sleep(1)


# ---- Unused loop variable ----

# VIOLATION: bugs/deterministic/unused-loop-variable
for unused_i in range(10):
    pass


# ---- Lambda assignment ----

# VIOLATION: bugs/deterministic/lambda-assignment
double = lambda x: x * 2


# ---- Dict iteration patterns ----

# VIOLATION: bugs/deterministic/dict-iter-missing-items
d = {"a": 1, "b": 2}
for k, v in d:
    pass


# ---- Unary prefix ----

x = 5
# VIOLATION: bugs/deterministic/unary-prefix-increment-decrement
y = ++x


# ---- All branches identical ----

def same_branches(x):
    # VIOLATION: bugs/deterministic/all-branches-identical
    if x > 0:
        return 1
    else:
        return 1


# ---- Duplicate set value ----

# VIOLATION: bugs/deterministic/duplicate-set-value
unique = {1, 2, 3, 1}


# ---- Duplicate args ----

# VIOLATION: bugs/deterministic/duplicate-function-arguments
def dup_args(a, b, a):
    return a + b


# ---- Non callable called ----

# VIOLATION: bugs/deterministic/non-callable-called
42()


# ---- Useless finally ----

def pointless_finally():
    # VIOLATION: bugs/deterministic/useless-finally
    try:
        return 42
    finally:
        pass


# ---- Exception reassignment ----

try:
    int("bad")
# VIOLATION: bugs/deterministic/exception-reassignment
except ValueError as e:
    e = "something else"


# ---- Return in generator ----

def gen_with_return():
    yield 1
    # VIOLATION: bugs/deterministic/return-in-generator
    return 42


# ---- Useless contextlib suppress ----

# VIOLATION: bugs/deterministic/useless-contextlib-suppress
with contextlib.suppress():
    pass


# ---- Logging exception outside handler ----

# VIOLATION: bugs/deterministic/logging-exception-outside-handler
logging.exception("failed outside handler")


# ---- Generic error message ----

def vague_error():
    # VIOLATION: bugs/deterministic/generic-error-message
    raise ValueError("error")


# ---- Assignment to self ----

x = 1
# VIOLATION: bugs/deterministic/self-assignment
x = x


# ---- Break continue in finally ----

def break_in_finally():
    for i in range(10):
        try:
            pass
        # VIOLATION: bugs/deterministic/break-continue-in-finally
        finally:
            break


# ---- Implicit optional ----

def implicit_opt(x: str = None):
    # VIOLATION: bugs/deterministic/implicit-optional
    return x


# ---- Nested try-catch ----

def nested_try():
    # VIOLATION: bugs/deterministic/nested-try-catch
    try:
        try:
            pass
        except ValueError:
            pass
    except Exception:
        pass


# ---- If tuple always true ----

# VIOLATION: bugs/deterministic/if-tuple-always-true
if (True, False):
    pass
