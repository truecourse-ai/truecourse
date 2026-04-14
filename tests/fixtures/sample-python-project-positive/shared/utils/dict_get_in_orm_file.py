"""missing-unique-constraint Phase 5 coverage.

This file imports SQLAlchemy (ORM) AND uses dict.get() inside if-blocks.
The rule must NOT fire on dict.get() patterns even in ORM-importing files,
because dict.get() is not a database query.

Zero violations expected.
"""
from sqlalchemy import create_engine


def process_config(config: dict) -> bool:
    """Dict.get inside if-block in a file that imports SQLAlchemy.

    Pre-Phase-5 this triggered missing-unique-constraint because the rule
    treated dict.get() as an ORM query method.
    """
    engine = create_engine(config.get("db_url", "sqlite://"))
    if config.get("name"):
        engine.dispose()
        return True

    value = config.get("email", "")
    if value:
        engine.dispose()
        return True
    return False
