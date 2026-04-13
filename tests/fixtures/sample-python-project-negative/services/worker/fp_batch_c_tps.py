"""FP batch C true-positive markers.

Each violation below is an ACTUAL issue that the batch C fixes must continue
to flag — they guard against the skips being too aggressive.
"""
import enum
from typing import Dict


# VIOLATION: code-quality/deterministic/subclass-builtin-collection
class MyDict(dict):
    """Subclassing dict directly — should use collections.UserDict."""
    pass


# VIOLATION: code-quality/deterministic/subclass-builtin-collection
class MyList(list):
    """Subclassing list directly — should use collections.UserList."""
    pass


# VIOLATION: code-quality/deterministic/boolean-trap
def launch_process(config):
    """Custom function with boolean positional arg — genuine trap."""
    return launch(True, config)


# VIOLATION: code-quality/deterministic/redeclared-assigned-name
def wasted_assignment():
    """x assigned then immediately overwritten — the first value is lost."""
    x = compute_a()
    x = compute_b()
    return x


# VIOLATION: code-quality/deterministic/type-check-without-type-error
def check_type_wrong_exception(value):
    """isinstance check raising RuntimeError — should be TypeError."""
    if not isinstance(value, int):
        raise RuntimeError("Expected an int")
    return value


# Helpers referenced above
def launch(flag, config):
    """Stand-in referenced above."""
    pass


def compute_a():
    """Stand-in referenced above."""
    return 1


def compute_b():
    """Stand-in referenced above."""
    return 2
