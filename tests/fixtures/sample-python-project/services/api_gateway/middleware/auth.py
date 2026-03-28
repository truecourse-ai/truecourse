from flask import request, g


def auth_middleware():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        return
    g.user_id = "authenticated-user"
