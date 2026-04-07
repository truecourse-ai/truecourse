"""Bug violations: framework-specific bugs (Flask, FastAPI, Django, etc.)."""
from flask import Flask, send_file, request
from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware


flask_app = Flask(__name__)
fastapi_app = FastAPI()


# VIOLATION: bugs/deterministic/flask-query-params-in-post
@flask_app.route("/submit", methods=["POST"])
def submit():
    name = request.args.get("name")
    return {"name": name}


# VIOLATION: bugs/deterministic/flask-header-access-keyerror
@flask_app.route("/headers")
def get_header():
    auth = request.headers["Authorization"]
    return auth


# VIOLATION: bugs/deterministic/flask-class-view-decorator-wrong
from flask.views import MethodView

@flask_app.route("/user")
class UserView(MethodView):
    def get(self):
        return {"name": "alice"}


# VIOLATION: bugs/deterministic/flask-preprocess-return-unhandled
flask_app.preprocess_request()


# VIOLATION: bugs/deterministic/flask-send-file-missing-mimetype
@flask_app.route("/download")
def download():
    buf = io.BytesIO(b"data")
    return send_file(buf)


# VIOLATION: bugs/deterministic/fastapi-204-with-body
@fastapi_app.delete("/items/{item_id}", status_code=204, response_model=dict)
def delete_item(item_id: int):
    return {"deleted": True}


# VIOLATION: bugs/deterministic/fastapi-child-router-order
parent_router = APIRouter()
child_router = APIRouter()
fastapi_app.include_router(parent_router, prefix="/api")
fastapi_app.include_router(child_router, prefix="/api/v2")


# VIOLATION: bugs/deterministic/fastapi-unused-path-parameter
@fastapi_app.get("/users/{user_id}")
def get_user():
    return {"name": "alice"}


# VIOLATION: bugs/deterministic/fastapi-redundant-response-model
from pydantic import BaseModel

class UserResponse(BaseModel):
    name: str

@fastapi_app.get("/user", response_model=UserResponse)
def get_user_detail() -> UserResponse:
    return UserResponse(name="alice")


# VIOLATION: bugs/deterministic/fastapi-cors-middleware-order
fastapi_app.add_middleware(CORSMiddleware, allow_origins=["*"])
fastapi_app.add_middleware(GZipMiddleware, minimum_size=1000)


# VIOLATION: bugs/deterministic/django-json-response-safe-flag
from django.http import JsonResponse

def api_view(request):
    return JsonResponse([1, 2, 3])
