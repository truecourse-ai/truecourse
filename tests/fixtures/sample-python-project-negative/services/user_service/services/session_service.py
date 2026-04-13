"""Session management service."""
from __future__ import invalid_feature  # VIOLATION: bugs/deterministic/future-feature-not-defined
import logging
import sys

logger = logging.getLogger(__name__)


# VIOLATION: bugs/deterministic/load-before-global-declaration
def update_session_count():
    session_count = session_count + 1
    global session_count


# VIOLATION: bugs/deterministic/nonlocal-and-global
def manage_sessions():
    counter = 0

    def increment():
        global counter
        nonlocal counter
        counter += 1

    increment()
    return counter


# VIOLATION: bugs/deterministic/nonlocal-without-binding
def track_active_sessions():
    count = 0
    def inner():
        nonlocal total
        total += 1
    inner()
    return count


# VIOLATION: bugs/deterministic/argument-type-mismatch-python
def validate_session(session_id, user_id):
    return session_id is not None and user_id is not None


def check_session():
    return validate_session("sess-123")


# VIOLATION: bugs/deterministic/singledispatch-method-mismatch
from functools import singledispatch


class SessionHandler:
    @singledispatch
    def handle(self, event):
        pass


# VIOLATION: bugs/deterministic/inconsistent-tuple-return-length
def get_session_info(session_id):
    if session_id:
        return (session_id, "active", 3600)
    return (session_id, "expired")


# VIOLATION: bugs/deterministic/parameter-initial-value-ignored
def configure_session(timeout=30, max_retries=3):
    timeout = 60
    return {"timeout": timeout, "retries": max_retries}


# VIOLATION: bugs/deterministic/potential-index-error
def get_latest_session():
    return [][0]


# VIOLATION: bugs/deterministic/yield-from-in-async
async def stream_sessions(source):
    yield from source


# VIOLATION: bugs/deterministic/access-annotations-from-class-dict
class SessionModel:
    name: str
    value: int


def get_annotations():
    return SessionModel.__dict__["__annotations__"]
