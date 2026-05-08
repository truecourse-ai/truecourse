"""Regression guard for the Python duplicate-string visitor's
SQLAlchemy / regex / schema-kwarg skips.

None of the strings below should be flagged even though each
appears 3+ times in the file.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import relationship


def schema_demo() -> tuple[object, object, object]:
    """`text(...)` calls — first arg bound to SQL semantics."""
    a = text("CURRENT_TIMESTAMP")
    b = text("CURRENT_TIMESTAMP")
    c = text("CURRENT_TIMESTAMP")
    return a, b, c


def relationship_demo() -> tuple[object, object, object]:
    """`relationship('User', back_populates='posts')` — class name + kwarg value."""
    r1 = relationship("User", back_populates="posts")
    r2 = relationship("User", back_populates="comments")
    r3 = relationship("User", back_populates="likes")
    return r1, r2, r3


# Regex pattern strings — bound to regex semantics.
_KEY = re.compile(r"^[a-z_]+$")
_KEY2 = re.compile(r"^[a-z_]+$")
_KEY3 = re.compile(r"^[a-z_]+$")


class FieldDemo(BaseModel):
    """Pydantic Field description / title kwargs — same string repeats across fields."""

    name: str = Field(description="The user's display name.")
    alias: str = Field(description="The user's display name.")
    alias2: str = Field(description="The user's display name.")
