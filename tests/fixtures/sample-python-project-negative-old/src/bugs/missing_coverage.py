"""Bug violations: additional rules for complete coverage."""


# VIOLATION: bugs/deterministic/assertion-after-expected-exception
def test_after_raise():
    try:
        risky()
    except ValueError:
        assert True


# VIOLATION: bugs/deterministic/except-non-exception-class
try:
    risky()
except int:
    pass


# VIOLATION: bugs/deterministic/import-star-undefined
from os import *
result = nonexistent_function()


# VIOLATION: bugs/deterministic/not-in-operator-incompatible
if 5 in 42:
    pass


# VIOLATION: bugs/deterministic/star-arg-after-keyword
def func(a, b, **kwargs):
    pass

func(a=1, *[2, 3])


# VIOLATION: bugs/deterministic/super-without-brackets
class Child(Parent):
    def __init__(self):
        super.__init__()


# VIOLATION: bugs/deterministic/undefined-local-variable
def use_undefined():
    print(undefined_var)
    undefined_var = 10


# VIOLATION: bugs/deterministic/undefined-name
result = completely_undefined_name + 1
