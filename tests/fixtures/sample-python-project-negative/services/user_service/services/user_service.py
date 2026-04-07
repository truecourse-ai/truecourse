from ..repositories.user_repository import UserRepository

repo = UserRepository()


class UserService:
    def get_all(self) -> list:
        return repo.find_all()

    def get_by_id(self, user_id: str):
        return repo.find_by_id(user_id)

    def create(self, data: dict):
        return repo.create(data)

    def delete(self, user_id: str) -> None:
        return repo.delete(user_id)
