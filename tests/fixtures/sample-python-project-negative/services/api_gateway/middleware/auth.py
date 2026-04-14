from flask import request, g


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def auth_middleware():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        return
    g.user_id = "authenticated-user"
