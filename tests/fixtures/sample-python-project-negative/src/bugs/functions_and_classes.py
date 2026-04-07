"""Bug violations: function definitions, class issues, and special methods."""
import asyncio
from dataclasses import dataclass


# VIOLATION: bugs/deterministic/mutable-default-arg
def append_to(item, target=[]):
    target.append(item)
    return target


# VIOLATION: bugs/deterministic/function-call-in-default-argument
def process(data, timestamp=datetime.now()):
    return data


# VIOLATION: bugs/deterministic/init-return-value
class BadInit:
    def __init__(self):
        return 42


# VIOLATION: bugs/deterministic/yield-in-init
class GeneratorInit:
    def __init__(self):
        yield 1


# VIOLATION: bugs/deterministic/getter-missing-return
class NoReturn:
    @property
    def value(self):
        self._value = 10


# VIOLATION: bugs/deterministic/property-without-return
class PropNoReturn:
    @property
    def name(self):
        x = "hello"


# VIOLATION: bugs/deterministic/property-param-count-wrong
class BadProp:
    @property
    def value(self, extra):
        return self._value


# VIOLATION: bugs/deterministic/instance-method-missing-self
class MissingSelf:
    def process():
        return "data"


# VIOLATION: bugs/deterministic/unexpected-special-method-signature
class BadLen:
    def __len__(self, other):
        return 0


# VIOLATION: bugs/deterministic/invalid-special-method-return-type
class BadBool:
    def __bool__(self):
        return "yes"


# VIOLATION: bugs/deterministic/infinite-recursion
def recurse():
    recurse()


# VIOLATION: bugs/deterministic/mutable-class-default
class SharedState:
    items = []


# VIOLATION: bugs/deterministic/mutable-dataclass-default
@dataclass
class Config:
    tags = []


# VIOLATION: bugs/deterministic/hashable-set-dict-member
bad_set = {[1, 2], "ok"}


# VIOLATION: bugs/deterministic/iter-not-returning-iterator
class BadIterable:
    def __iter__(self):
        return [1, 2, 3]


# VIOLATION: bugs/deterministic/iter-returns-iterable
class ReturnsList:
    def __iter__(self) -> Iterable[int]:
        return iter([1, 2, 3])


# SKIP: bugs/deterministic/bad-staticmethod-argument
class BadStatic:
    @staticmethod
    def process(self, data):
        return data


# VIOLATION: bugs/deterministic/exit-method-wrong-signature
class BadContext:
    def __exit__(self):
        pass


# VIOLATION: bugs/deterministic/classmethod-first-argument-naming
class BadClassmethod:
    @classmethod
    def create(self):
        return self()


# VIOLATION: bugs/deterministic/non-callable-called
42()
# VIOLATION: bugs/deterministic/non-callable-called
"hello"()


# SKIP: bugs/deterministic/single-string-slots
class StringSlots:
    __slots__ = "name"


# VIOLATION: bugs/deterministic/non-slot-assignment
class Slotted:
    __slots__ = ("x", "y")
    def __init__(self):
        self.z = 3


# VIOLATION: bugs/deterministic/post-init-default
@dataclass
class PostInitBug:
    name: str
    def __post_init__(self, extra=None):
        pass


# SKIP: bugs/deterministic/implicit-classvar-in-dataclass
@dataclass
class ImplicitClassvar:
    name: str
    MAX_SIZE: int = 100


# VIOLATION: bugs/deterministic/dataclass-enum-conflict
from enum import Enum

@dataclass
class BadEnum(Enum):
    value: int = 0
