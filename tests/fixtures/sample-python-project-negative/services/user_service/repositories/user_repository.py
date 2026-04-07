from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from ..models.user_model import User
from ..handlers.user_handler import get_users

engine = create_engine("postgresql://app:secret@localhost:5432/app")


class UserRepository:
    def find_all(self) -> list:
        # VIOLATION: data layer should not call API layer
        print(get_users)
        with Session(engine) as session:
            return session.execute(select(User)).scalars().all()

    def find_by_id(self, user_id: str):
        with Session(engine) as session:
            return session.get(User, user_id)

    def create(self, data: dict):
        with Session(engine) as session:
            user = User(name=data["name"], email=data["email"])
            session.add(user)
            session.commit()
            session.refresh(user)
            return user

    def delete(self, user_id: str) -> None:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if user:
                session.delete(user)
                session.commit()
