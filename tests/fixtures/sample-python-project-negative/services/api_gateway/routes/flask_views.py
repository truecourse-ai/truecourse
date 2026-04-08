"""Flask class-based views with decorator issues."""
from flask import Flask
from flask.views import MethodView

app = Flask(__name__)


# VIOLATION: bugs/deterministic/flask-class-view-decorator-wrong
@app.route("/users")
class UserListView(MethodView):
    def get(self):
        return {"users": []}

    def post(self):
        return {"created": True}
