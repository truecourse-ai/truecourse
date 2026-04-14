"""Token model using SQLAlchemy 2.0 mapped_column() syntax.

Tests: mapped_column with nested Mapped types, multi-line definitions,
ForeignKey with extra args (ondelete), and relationship with Mapped typing.
"""

from typing import Optional
from sqlalchemy import BigInteger, String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .user_model import Base


# VIOLATION: style/deterministic/docstring-completeness
class Token(Base):
    __tablename__ = "tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    context: Mapped[Optional[str]] = mapped_column(String(64))
    user: Mapped["User"] = relationship("User")
