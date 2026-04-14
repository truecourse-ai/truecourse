"""Authentication handler with various bug patterns."""
import os
import re
import sys
import logging
from typing import Union, Never

logger = logging.getLogger(__name__)


# VIOLATION: bugs/deterministic/duplicate-args
def authenticate_user(username, password, username):
    return username == "admin" and password == "secret"


# VIOLATION: bugs/deterministic/duplicate-else-if
def get_auth_level(role):
    if role == "admin":
        return 3
    elif role == "moderator":
        return 2
    elif role == "admin":
        return 3
    else:
        return 1


# VIOLATION: bugs/deterministic/duplicate-entry-dunder-all
__all__ = [
    "authenticate_user",
    "get_auth_level",
    "authenticate_user",
]


# VIOLATION: bugs/deterministic/duplicate-import
import hashlib
import hashlib


# VIOLATION: bugs/deterministic/assertion-incompatible-types
def test_auth_response():
    assert 42 == "42"


# VIOLATION: bugs/deterministic/assert-with-print-message
def test_login_flow():
    user = {"name": "test"}
    assert user is not None, print("User should not be None")


# VIOLATION: bugs/deterministic/assertion-after-expected-exception
def test_invalid_password():
    try:
        authenticate_user("admin", "wrong", "admin")
    except ValueError:
        assert True


# VIOLATION: bugs/deterministic/assignment-in-assert
def validate_token(token):
    assert (result := verify_token(token)) is not None
    return result


# VIOLATION: bugs/deterministic/raise-literal
def fail_auth():
    raise "Authentication failed"


# VIOLATION: bugs/deterministic/raise-without-from-in-except
def wrap_auth_error():
    try:
        authenticate_user("a", "b", "a")
    except TypeError as e:
        raise ValueError("Auth failed")


# VIOLATION: bugs/deterministic/bare-raise-in-finally
def cleanup_session(session):
    try:
        session.close()
    finally:
        raise


# VIOLATION: bugs/deterministic/return-in-try-except-finally
def safe_get_token(request):
    try:
        return request.headers["Authorization"]
    except KeyError:
        return None
    finally:
        return "fallback"


# VIOLATION: bugs/deterministic/unsafe-finally
def process_credentials(creds):
    try:
        return validate_credentials(creds)
    finally:
        return {"status": "done"}


# VIOLATION: bugs/deterministic/default-except-not-last
def handle_login(request):
    try:
        return authenticate_user("user", "pass", "user")
    except:
        logger.error("Unknown error")
    except ValueError:
        logger.error("Validation error")


# VIOLATION: bugs/deterministic/except-non-exception-class
def safe_auth_check():
    try:
        authenticate_user("a", "b", "a")
    except int:
        pass


# VIOLATION: bugs/deterministic/except-with-empty-tuple
def robust_auth():
    try:
        authenticate_user("a", "b", "a")
    except ():
        pass


# VIOLATION: bugs/deterministic/exit-re-raise-in-except
class AuthSession:
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_val:
            raise exc_val


# VIOLATION: bugs/deterministic/exception-group-misuse
def handle_errors():
    try:
        pass
    except* ExceptionGroup:
        raise ValueError("Converted error")


# VIOLATION: bugs/deterministic/never-union
def get_user_or_error() -> Union[dict, Never]:
    return {"name": "admin"}


# VIOLATION: bugs/deterministic/not-implemented-in-bool-context
class AuthProvider:
    def is_configured(self):
        if NotImplemented:
            return True
        return False


# VIOLATION: bugs/deterministic/not-in-operator-incompatible
def check_permissions(user_id):
    if user_id in 42:
        return True
    return False


# VIOLATION: bugs/deterministic/unreliable-callable-check
def validate_callback(callback):
    if hasattr(callback, "__call__"):
        return callback()
    return None


# VIOLATION: bugs/deterministic/unnecessary-equality-check
def is_admin(user):
    return user.role == user.role


# VIOLATION: bugs/deterministic/unreliable-sys-version-check
def check_python_version():
    if sys.version[0] == "3":
        return True
    return False


# VIOLATION: bugs/deterministic/named-expr-without-context
(x := 10)


# VIOLATION: bugs/deterministic/non-iterable-unpacking
def unpack_auth_result():
    a, b = 200


def verify_token(token):
    return token


def validate_credentials(creds):
    return creds
