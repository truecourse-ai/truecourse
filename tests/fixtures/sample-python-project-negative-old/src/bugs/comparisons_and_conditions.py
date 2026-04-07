"""Bug violations: comparisons, conditions, and identity checks."""
import math
import float as _float_module


# VIOLATION: bugs/deterministic/self-comparison
def check_value(x):
    if x == x:
        return True


# VIOLATION: bugs/deterministic/constant-condition
def dead_branch():
    if False:
        do_something()


# VIOLATION: bugs/deterministic/all-branches-identical
def same_branches(x):
    if x > 0:
        return 1
    else:
        return 1


# VIOLATION: bugs/deterministic/duplicate-else-if
def dup_elif(x):
    if x > 10:
        return "big"
    elif x > 5:
        return "medium"
    elif x > 10:
        return "also big"


# VIOLATION: bugs/deterministic/is-literal-comparison
def check_literal(x):
    if x is "hello":
        return True


# VIOLATION: bugs/deterministic/none-comparison-with-equality
def check_none(x):
    if x == None:
        return True


# VIOLATION: bugs/deterministic/type-comparison-instead-of-isinstance
def check_type(x):
    if type(x) == int:
        return True


# VIOLATION: bugs/deterministic/float-equality-comparison
def check_float(x):
    if x == 0.1:
        return True


# VIOLATION: bugs/deterministic/nan-comparison
def check_nan(x):
    if x == float("nan"):
        return True


# VIOLATION: bugs/deterministic/not-implemented-in-bool-context
def check_not_impl():
    if NotImplemented:
        pass


# VIOLATION: bugs/deterministic/comparison-to-none-constant
if MyObject() is None:
    pass


# VIOLATION: bugs/deterministic/new-object-identity-check
def check_identity():
    x = get_value()
    if MyObject() is x:
        pass


# VIOLATION: bugs/deterministic/if-tuple-always-true
def tuple_check():
    if (True, False):
        pass


# VIOLATION: bugs/deterministic/assert-on-tuple
assert (1, 2)


# VIOLATION: bugs/deterministic/assert-false
assert False


# VIOLATION: bugs/deterministic/assert-on-string-literal
assert "this is always true"


# VIOLATION: bugs/deterministic/assert-with-print-message
assert x > 0, print("x must be positive")


# VIOLATION: bugs/deterministic/assignment-in-assert
assert (result := compute()) > 0


# VIOLATION: bugs/deterministic/invalid-assert-message
assert x > 0, 42


# VIOLATION: bugs/deterministic/identity-with-dissimilar-types
if 42 is "hello":
    pass


# VIOLATION: bugs/deterministic/unnecessary-equality-check
if 42 == "42":
    pass
