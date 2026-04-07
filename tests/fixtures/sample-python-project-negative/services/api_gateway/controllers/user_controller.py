"""User controller."""


class UserController:
    def get_user(self, user_id):
        return {"id": user_id}

    def create_user(self, data):
        return {"created": True}
