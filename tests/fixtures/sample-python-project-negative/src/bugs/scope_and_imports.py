"""Bug violations: scope, imports, globals, and module-level issues."""
import os
import sys
from contextvars import ContextVar


# SKIP: bugs/deterministic/global-at-module-level
global module_var


# VIOLATION: bugs/deterministic/nonlocal-and-global
def confusing_scope():
    x = 10
    def inner():
        global x
        nonlocal x
        x = 20


# VIOLATION: bugs/deterministic/nonlocal-without-binding
def missing_outer():
    x = 10
    def inner():
        nonlocal missing
        missing = 10


# VIOLATION: bugs/deterministic/load-before-global-declaration
def use_before_global():
    print(counter)
    global counter
    counter = 0


# VIOLATION: bugs/deterministic/import-self
import scope_and_imports


# VIOLATION: bugs/deterministic/undefined-export
__all__ = ["exported_func", "nonexistent_func"]

def exported_func():
    pass


# VIOLATION: bugs/deterministic/invalid-all-object
__all__ = ["func_a", 42, "func_b"]


# VIOLATION: bugs/deterministic/unsupported-method-call-on-all
__all__ = ["func"]
__all__.extend(["other"])


# VIOLATION: bugs/deterministic/assignment-to-os-environ
os.environ = {"PATH": "/usr/bin"}


# VIOLATION: bugs/deterministic/invalid-envvar-value
val = os.getenv(42)


# VIOLATION: bugs/deterministic/lowercase-environment-variable
os.environ["my_debug_flag"] = "true"


# VIOLATION: bugs/deterministic/mutable-contextvar-default
ctx = ContextVar("ctx", default=[])


# VIOLATION: bugs/deterministic/mutable-fromkeys-value
data = dict.fromkeys(["a", "b", "c"], [])


# VIOLATION: bugs/deterministic/shared-mutable-module-state
module_cache = {}


# VIOLATION: bugs/deterministic/parameter-initial-value-ignored
def overwritten_param(x=10):
    x = 20
    return x


# VIOLATION: bugs/deterministic/dict-iter-missing-items
config = {"a": 1, "b": 2}
for k, v in config:
    print(k, v)


# VIOLATION: bugs/deterministic/dict-index-missing-items
class MyDict:
    def __getitem__(self, key):
        return self._data[key]


# SKIP: bugs/deterministic/falsy-dict-get-fallback
val = config.get("key", [])


# VIOLATION: bugs/deterministic/defaultdict-default-factory-kwarg
from collections import defaultdict
dd = defaultdict(default_factory=list)
