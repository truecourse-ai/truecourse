"""Bug violations: exception handling and error patterns."""
import re
import asyncio
import contextlib
import logging
import warnings
from itertools import groupby


# VIOLATION: bugs/deterministic/empty-catch
try:
    open("file.txt")
except FileNotFoundError:
    pass


# VIOLATION: bugs/deterministic/bare-except
try:
    result = 1 / 0
except:
    print("caught")


# VIOLATION: bugs/deterministic/exception-reassignment
try:
    x = int("bad")
except ValueError as e:
    e = "something else"
    print(e)


# VIOLATION: bugs/deterministic/raise-not-implemented
def abstract_method():
    raise NotImplemented


# VIOLATION: bugs/deterministic/raise-literal
def bad_raise():
    raise "something went wrong"


# VIOLATION: bugs/deterministic/raise-without-from-in-except
def convert_error():
    try:
        x = int("bad")
    except ValueError:
        raise RuntimeError("conversion failed")


# VIOLATION: bugs/deterministic/unsafe-finally
def unsafe_finally():
    try:
        return compute()
    finally:
        return -1


# VIOLATION: bugs/deterministic/break-continue-in-finally
def break_in_finally():
    for i in range(10):
        try:
            process(i)
        finally:
            break


# VIOLATION: bugs/deterministic/cancellation-exception-not-reraised
async def handle_cancel():
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        logging.info("was cancelled")


# VIOLATION: bugs/deterministic/exception-not-from-base-exception
class MyError(str):
    pass


# VIOLATION: bugs/deterministic/exception-group-misuse
try:
    do_something()
except* ExceptionGroup:
    pass


# VIOLATION: bugs/deterministic/binary-op-exception
try:
    risky()
except ValueError or TypeError:
    pass


# VIOLATION: bugs/deterministic/redundant-tuple-in-exception
try:
    risky()
except (ValueError,):
    pass


# VIOLATION: bugs/deterministic/except-with-empty-tuple
try:
    risky()
except ():
    pass


# VIOLATION: bugs/deterministic/duplicate-handler-exception
try:
    risky()
except (ValueError, ValueError):
    pass


# VIOLATION: bugs/deterministic/default-except-not-last
try:
    risky()
except:
    pass
except ValueError:
    pass


# VIOLATION: bugs/deterministic/useless-exception-statement
def bad_exception_handling():
    ValueError("new error")


# VIOLATION: bugs/deterministic/useless-finally
def pointless_finally():
    try:
        return 42
    finally:
        pass


# VIOLATION: bugs/deterministic/useless-contextlib-suppress
with contextlib.suppress():
    risky()


# VIOLATION: bugs/deterministic/assert-raises-too-broad
import pytest

def test_broad():
    with pytest.raises(Exception):
        do_something()


# VIOLATION: bugs/deterministic/exit-re-raise-in-except
class BadContextManager:
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_val:
            raise exc_val


# VIOLATION: bugs/deterministic/bare-raise-in-finally
def bare_raise_finally():
    try:
        return 1
    finally:
        raise


# VIOLATION: bugs/deterministic/return-in-try-except-finally
def return_in_all_branches():
    try:
        return 1
    except Exception:
        return 2
    finally:
        return 3


# VIOLATION: bugs/deterministic/logging-exception-outside-handler
logging.exception("something failed")


# VIOLATION: bugs/deterministic/logging-exception-no-exc-info
def log_err():
    try:
        risky()
    except Exception:
        logging.error("failed", exc_info=False)


# VIOLATION: bugs/deterministic/logging-deprecated-warn
logging.warn("use warning instead")


# VIOLATION: bugs/deterministic/logging-invalid-getlogger
logger = logging.getLogger(__file__)


# VIOLATION: bugs/deterministic/logging-args-mismatch
logging.info("value is %s %s", 42)


# VIOLATION: bugs/deterministic/warnings-no-stacklevel
def emit_warning():
    warnings.warn("deprecated")


# VIOLATION: bugs/deterministic/generic-error-message
def vague_error():
    raise ValueError("error")


# VIOLATION: bugs/deterministic/reuse-groupby-generator
data = [("a", 1), ("a", 2), ("b", 3)]
groups = [(k, list(g)) for k, g in groupby(data, key=lambda x: x[0])]
for k, g in groupby(data, key=lambda x: x[0]):
    first = list(g)
    second = list(g)
