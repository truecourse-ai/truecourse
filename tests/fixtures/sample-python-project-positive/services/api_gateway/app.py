"""API Gateway Flask application."""
import os

from flask import Flask

app = Flask(__name__)

DEFAULT_PORT = 3000
PORT = int(os.environ.get("PORT", DEFAULT_PORT))
MAIN_MODULE = "__main__"

if __name__ == MAIN_MODULE:
    app.run(port=PORT)
