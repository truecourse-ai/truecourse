"""User service Flask application."""
import os

from flask import Flask

app = Flask(__name__)

DEFAULT_PORT = 3001
PORT = int(os.environ.get("USER_SERVICE_PORT", DEFAULT_PORT))
MAIN_MODULE = "__main__"

if __name__ == MAIN_MODULE:
    app.run(port=PORT)
