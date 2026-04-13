"""Session repository with various bug patterns."""
import os
import sys
import logging
from typing import TypeVar, Generic
from typing import Optional

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


# (undefined-export moved after invalid-all-object below)


# SKIP: import-self — agent fix uses full module path comparison
import session_repository


# VIOLATION: bugs/deterministic/import-star-undefined
from utils import *


# VIOLATION: bugs/deterministic/redefined-argument-from-local
def process_sessions(session_list, user_id):
    for user_id in range(10):
        pass
    return session_list


# VIOLATION: bugs/deterministic/redefined-while-unused
import json
import json


# VIOLATION: bugs/deterministic/used-dummy-variable
def get_session_metadata(_sessions):
    result = _sessions[0].get("metadata")
    return result


# VIOLATION: bugs/deterministic/star-assignment-error
def unpack_session_data(data):
    a, *b, *c = data
    return a


# VIOLATION: bugs/deterministic/star-arg-after-keyword
def call_with_bad_args():
    create_session(timeout=30, *[1, 2, 3])


# VIOLATION: bugs/deterministic/invalid-all-object
__all__ = ["SessionRepository", 42, None]


# VIOLATION: bugs/deterministic/undefined-export
__all__ = [
    "SessionRepository",
    "get_session",
    "NonExistentClass",
]


# VIOLATION: bugs/deterministic/invalid-assert-message
def validate_session(session):
    assert session is not None, 42


# VIOLATION: bugs/deterministic/unsupported-method-call-on-all
def extend_exports():
    __all__.append("NewExport")


class SessionRepository:
    """Repository for managing user sessions."""

    def __init__(self, db_connection):
        self.db = db_connection

    def get_session(self, session_id):
        return self.db.query(f"SELECT * FROM sessions WHERE id = '{session_id}'")

    def create_session(self, user_id, **kwargs):
        return {"user_id": user_id, "active": True}


def create_session(**kwargs):
    return kwargs


def get_session(session_id):
    return {"id": session_id}
