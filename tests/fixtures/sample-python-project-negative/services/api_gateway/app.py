import os

from flask import Flask
from .routes.users import users_bp
from .routes.health import health_bp

app = Flask(__name__)

app.register_blueprint(users_bp, url_prefix="/api/users")
app.register_blueprint(health_bp, url_prefix="/api/health")

PORT = int(os.environ.get("PORT", 3000))

if __name__ == "__main__":
    app.run(port=PORT)
