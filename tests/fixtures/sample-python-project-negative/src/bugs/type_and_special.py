"""Bug violations: type checking, special methods, and misc patterns."""
import os
import sys
import subprocess
import math
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock


# VIOLATION: bugs/deterministic/bad-open-mode
f = open("data.txt", "rx")


# VIOLATION: bugs/deterministic/zip-without-strict
pairs = zip([1, 2, 3], ["a", "b"])


# VIOLATION: bugs/deterministic/map-without-strict
result = map(lambda x, y: x + y, [1, 2], [3, 4, 5])


# VIOLATION: bugs/deterministic/batched-without-strict
from itertools import batched
chunks = batched([1, 2, 3, 4, 5], 2)


# VIOLATION: bugs/deterministic/datetime-without-timezone
now = datetime.now()


# VIOLATION: bugs/deterministic/datetime-min-max
earliest = datetime.min


# VIOLATION: bugs/deterministic/datetime-12h-format-without-ampm
formatted = now.strftime("%I:%M:%S")


# VIOLATION: bugs/deterministic/datetime-constructor-range
bad_date = datetime(2024, 13, 1)


# VIOLATION: bugs/deterministic/decimal-from-float
amount = Decimal(0.1)


# VIOLATION: bugs/deterministic/math-isclose-zero-no-abstol
close = math.isclose(0.0, 1e-10)


# VIOLATION: bugs/deterministic/os-path-commonprefix-bug
common = os.path.commonprefix(["/usr/lib", "/usr/local"])


# VIOLATION: bugs/deterministic/subprocess-popen-preexec-fn
proc = subprocess.Popen(["ls"], preexec_fn=os.setpgrp)


# VIOLATION: bugs/deterministic/invalid-mock-access
mock = MagicMock()
mock.assert_called_once()


# VIOLATION: bugs/deterministic/invalid-pathlib-with-suffix
p = Path("file.txt").with_suffix("bak")


# SKIP: bugs/deterministic/invalid-print-syntax
print >> sys.stderr


# VIOLATION: bugs/deterministic/unintentional-type-annotation
x: int


# VIOLATION: bugs/deterministic/unreliable-callable-check
def is_callable(obj):
    return hasattr(obj, "__call__")


# VIOLATION: bugs/deterministic/unreliable-sys-version-check
if sys.version[0] == "3":
    pass


# VIOLATION: bugs/deterministic/return-in-generator
def bad_generator():
    yield 1
    return [2, 3]


# VIOLATION: bugs/deterministic/potential-index-error
val = [1, 2][5]


# VIOLATION: bugs/deterministic/non-iterable-unpacking
a, b = 42


# VIOLATION: bugs/deterministic/invalid-index-type
items = [1, 2, 3]
val = items[1.5]


# VIOLATION: bugs/deterministic/incompatible-operator-types
result = "hello" + 42


# VIOLATION: bugs/deterministic/item-operation-unsupported
val = 42[0]


# class-mixed-typevars needs PEP 695 syntax (Python 3.12+)
from typing import TypeVar, Generic
T = TypeVar("T")
U = TypeVar("U", bound=int)


# VIOLATION: bugs/deterministic/assertion-incompatible-types
assert 5 == "5"


# VIOLATION: bugs/deterministic/never-union
from typing import Union, Never
BadType = Union[int, Never]


# VIOLATION: bugs/deterministic/implicit-optional
def greet(name: str = None):
    print(name)


# VIOLATION: bugs/deterministic/in-empty-collection
if x in []:
    pass


# VIOLATION: bugs/deterministic/named-expr-without-context
(y := 10)


# VIOLATION: bugs/deterministic/forward-annotation-syntax-error
def func(x: "int[") -> None:
    pass


# VIOLATION: bugs/deterministic/lambda-assignment
square = lambda x: x ** 2
