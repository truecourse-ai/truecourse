"""Code quality violations: types, classes, OOP, and annotations."""
import typing
from abc import ABC, abstractmethod
from typing import Any, List, Dict, Optional, Union, Literal, TypeVar
from enum import Enum
from functools import lru_cache
import logging


# SKIP: code-quality/deterministic/no-explicit-any
def process(data: Any) -> Any:
    return data


# VIOLATION: code-quality/deterministic/any-type-hint
def flexible(x: Any):
    return x


# VIOLATION: code-quality/deterministic/missing-type-hints
def no_hints(x, y):
    return x + y


# VIOLATION: code-quality/deterministic/blanket-type-ignore
result = bad_call()  # type: ignore


# VIOLATION: code-quality/deterministic/isinstance-type-none
def check_none_type(x):
    return isinstance(x, type(None))


# VIOLATION: code-quality/deterministic/confusing-type-check
def bad_check(x):
    if type(x) == int:
        return True


# SKIP: code-quality/deterministic/duplicate-isinstance-call
def dup_isinstance(x):
    if isinstance(x, int):
        return "int"
    elif isinstance(x, int):
        return "also int"


# VIOLATION: code-quality/deterministic/type-check-without-type-error
def strict_type(x):
    if not isinstance(x, str):
        raise ValueError("expected string")


# VIOLATION: code-quality/deterministic/generic-type-unparameterized
def get_items() -> List:
    return [1, 2, 3]


# VIOLATION: code-quality/deterministic/legacy-type-hint-syntax
def old_style(x: typing.List) -> typing.Dict:
    return {}


# VIOLATION: code-quality/deterministic/legacy-generic-syntax
T = TypeVar('T')


# VIOLATION: code-quality/deterministic/non-unique-enum-values
class Color(Enum):
    RED = 1
    GREEN = 2
    BLUE = 1


# VIOLATION: code-quality/deterministic/eq-without-hash
class Comparable:
    def __eq__(self, other):
        return self.value == other.value


# VIOLATION: code-quality/deterministic/self-first-argument
class BadSelf:
    def method(this):
        return this


# VIOLATION: code-quality/deterministic/no-self-use
class Stateless:
    def compute(self, x, y):
        return x + y


# VIOLATION: code-quality/deterministic/property-with-parameters
class PropParams:
    @property
    def value(self, extra=None):
        return self._value


# VIOLATION: code-quality/deterministic/boolean-trap
def connect(host, port, ssl_flag):
    pass

connect("localhost", 8080, True)


# VIOLATION: code-quality/deterministic/private-member-access
class Secret:
    def __init__(self):
        self._hidden = 42

s = Secret()
val = s._hidden


# VIOLATION: code-quality/deterministic/field-duplicates-class-name
class User:
    User = None


# VIOLATION: code-quality/deterministic/cached-instance-method
class Cached:
    @lru_cache(maxsize=128)
    def compute(self, x):
        return x * 2


# VIOLATION: code-quality/deterministic/metaclass-abcmeta
from abc import ABCMeta
class OldStyle(metaclass=ABCMeta):
    @abstractmethod
    def do_thing(self):
        pass


# VIOLATION: code-quality/deterministic/class-as-data-structure
class DataOnly:
    def __init__(self):
        self.x = 1
        self.y = 2
        self.z = 3


# VIOLATION: code-quality/deterministic/error-instead-of-exception
def handle_api():
    try:
        call_api()
    except Exception as e:
        logging.error("API call failed")


# VIOLATION: code-quality/deterministic/exception-base-class
class CustomError(BaseException):
    pass


# VIOLATION: code-quality/deterministic/bad-dunder-method-name
class BadDunder:
    def __init__(self):
        pass

    def __hello__(self):
        pass


# VIOLATION: code-quality/deterministic/builtin-shadowing
list = [1, 2, 3]
dict = {"a": 1}


# VIOLATION: code-quality/deterministic/subclass-builtin-collection
class MyList(list):
    pass


# SKIP: code-quality/deterministic/return-not-implemented
class Arithmetic:
    def __add__(self, other):
        raise NotImplementedError()


# VIOLATION: code-quality/deterministic/magic-value-comparison
def check_status(code):
    if code == 200:
        return "ok"
    elif code == 404:
        return "not found"


# VIOLATION: code-quality/deterministic/comparison-of-constant
if 42 == 42:
    pass


# VIOLATION: code-quality/deterministic/unconditional-assertion
def always_assert():
    assert True


# VIOLATION: code-quality/deterministic/duplicate-class-field
class DupField:
    x = 1
    x = 2


# VIOLATION: code-quality/deterministic/pydantic-optional-default
from pydantic import BaseModel

class UserModel(BaseModel):
    name: Optional[str]


# VIOLATION: code-quality/deterministic/explicit-fstring-conversion
name = "alice"
msg = f"{str(name)}"


# VIOLATION: code-quality/deterministic/raw-string-in-exception
raise ValueError(r"raw \n string in error")


# VIOLATION: code-quality/deterministic/raise-vanilla-args
raise ValueError("This is a very long error message that exceeds the threshold of fifty characters significantly")


# VIOLATION: code-quality/deterministic/raise-within-try
def risky_raise():
    try:
        raise ValueError("inner")
    except Exception:
        pass


# VIOLATION: code-quality/deterministic/verbose-raise
def verbose():
    try:
        risky()
    except ValueError as e:
        raise e


# VIOLATION: code-quality/deterministic/verbose-log-message
def log_verbose():
    try:
        risky()
    except Exception as e:
        logging.exception("Error occurred", str(e))


# VIOLATION: code-quality/deterministic/unconditional-assertion
assert True, "always passes"


# SKIP: code-quality/deterministic/redefined-loop-name
for x in range(10):
    x = x * 2


# VIOLATION: code-quality/deterministic/unused-unpacked-variable
a, b, c = get_tuple()
return a


# SKIP: code-quality/deterministic/duplicate-union-literal-member
Mode = Literal["read", "write", "read"]


# VIOLATION: code-quality/deterministic/unnecessary-type-union
BadUnion = type[int] | type[str]


# VIOLATION: code-quality/deterministic/unused-annotation
def annotated_func():
    x: int
    return 42
