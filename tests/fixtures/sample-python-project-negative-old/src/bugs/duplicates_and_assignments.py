"""Bug violations: duplicates, assignments, keys, and set values."""


# VIOLATION: bugs/deterministic/duplicate-keys
config = {
    "host": "localhost",
    "port": 8080,
    "host": "0.0.0.0",
}


# VIOLATION: bugs/deterministic/duplicate-dict-key
settings = {"debug": x for x in range(10)}


# VIOLATION: bugs/deterministic/duplicate-set-value
allowed = {1, 2, 3, 2}


# VIOLATION: bugs/deterministic/duplicate-args
def process(a, b, a):
    return a + b


# VIOLATION: bugs/deterministic/duplicate-function-arguments
result = my_func(name="alice", age=30, name="bob")


# VIOLATION: bugs/deterministic/duplicate-class-members
class Widget:
    def render(self):
        return "v1"

    def render(self):
        return "v2"


# VIOLATION: bugs/deterministic/duplicate-base-classes
class MyClass(list, dict, list):
    pass


# VIOLATION: bugs/deterministic/self-assignment
def process_data(data):
    data = data


# VIOLATION: bugs/deterministic/self-or-cls-assignment
class Foo:
    def method(self):
        self = "reassigned"


# VIOLATION: bugs/deterministic/duplicate-import
import os
import os


# VIOLATION: bugs/deterministic/duplicate-entry-dunder-all
__all__ = ["func_a", "func_b", "func_a"]


# VIOLATION: bugs/deterministic/redefined-while-unused
import json
import json as json


# VIOLATION: bugs/deterministic/redefined-argument-from-local
def transform(items):
    for items in range(10):
        pass


# VIOLATION: bugs/deterministic/members-differ-only-by-case
class Confusing:
    def getValue(self):
        return 1

    def getvalue(self):
        return 2
