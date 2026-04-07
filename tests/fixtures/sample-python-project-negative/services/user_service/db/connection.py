from sqlalchemy import create_engine
from sqlalchemy.orm import Session

_engine = None


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def connect_database():
    # VIOLATION: code-quality/deterministic/global-statement
    global _engine
    if not _engine:
        # VIOLATION: security/deterministic/hardcoded-database-password
        _engine = create_engine("postgresql://app:secret@localhost:5432/app")
    return _engine


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def disconnect_database():
    # VIOLATION: code-quality/deterministic/global-statement
    global _engine
    if _engine:
        _engine.dispose()
        _engine = None
