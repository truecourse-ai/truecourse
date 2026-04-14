from ..repositories.user_repository import UserRepository

repo = UserRepository()


# VIOLATION: style/deterministic/docstring-completeness
class UserService:
    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def get_all(self) -> list:
        return repo.find_all()

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def get_by_id(self, user_id: str):
        return repo.find_by_id(user_id)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def create(self, data: dict):
        return repo.create(data)

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    def delete(self, user_id: str) -> None:
        return repo.delete(user_id)
