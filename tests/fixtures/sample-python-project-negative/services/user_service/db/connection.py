from sqlalchemy import create_engine
from sqlalchemy.orm import Session

_engine = None


def connect_database():
    global _engine
    if not _engine:
        _engine = create_engine("postgresql://app:secret@localhost:5432/app")
    return _engine


def disconnect_database():
    global _engine
    if _engine:
        _engine.dispose()
        _engine = None
