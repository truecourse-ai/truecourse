from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from ..models.user_model import User
from ..handlers.user_handler import get_users

# VIOLATION: security/deterministic/hardcoded-database-password
engine = create_engine("postgresql://app:secret@localhost:5432/app")


# VIOLATION: style/deterministic/docstring-completeness
class UserRepository:
    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def find_all(self) -> list:
        # ARCH-VIOLATION: architecture/deterministic/data-layer-depends-on-api
        # VIOLATION: code-quality/deterministic/console-log
        print(get_users)
        with Session(engine) as session:
            return session.execute(select(User)).scalars().all()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def find_by_id(self, user_id: str):
        with Session(engine) as session:
            return session.get(User, user_id)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def create(self, data: dict):
        with Session(engine) as session:
            user = User(name=data["name"], email=data["email"])
            session.add(user)
            session.commit()
            session.refresh(user)
            return user

    # VIOLATION: style/deterministic/docstring-completeness
    def delete(self, user_id: str) -> None:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if user:
                session.delete(user)
                session.commit()
