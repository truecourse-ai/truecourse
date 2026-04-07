from datetime import datetime


# VIOLATION: style/deterministic/docstring-completeness
def format_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "displayName": f"{user['name']} <{user['email']}>",
        "createdAt": datetime.fromisoformat(str(user["createdAt"])).isoformat(),
    }


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-maxsplit-arg
def format_date(date: datetime) -> str:
    return date.isoformat().split("T")[0]
