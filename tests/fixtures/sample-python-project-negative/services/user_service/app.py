import os

from flask import Flask
from .routes import users_bp
from .db.connection import connect_database

app = Flask(__name__)

app.register_blueprint(users_bp, url_prefix="/users")

PORT = int(os.environ.get("PORT", 3001))


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def start():
    connect_database()
    app.run(port=PORT)


if __name__ == "__main__":
    start()
