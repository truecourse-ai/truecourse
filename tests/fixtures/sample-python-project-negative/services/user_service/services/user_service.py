"""User service business logic."""


class UserService:
    def __init__(self, repository):
        self.repository = repository

    def get_user(self, user_id):
        return self.repository.find_by_id(user_id)

    def create_user(self, name, email):
        from ..models.user_model import User
        user = User(id=0, name=name, email=email)
        return self.repository.create(user)
