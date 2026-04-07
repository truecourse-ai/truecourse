"""User repository."""


class UserRepository:
    def __init__(self, db):
        self.db = db

    def find_by_id(self, user_id):
        return self.db.execute("SELECT id, name, email FROM users WHERE id = %s", (user_id,)).fetchone()

    def create(self, user):
        self.db.execute("INSERT INTO users (name, email) VALUES (%s, %s)", (user.name, user.email))
