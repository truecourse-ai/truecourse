from datetime import datetime


def format_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "displayName": f"{user['name']} <{user['email']}>",
        "createdAt": datetime.fromisoformat(str(user["createdAt"])).isoformat(),
    }


def format_date(date: datetime) -> str:
    return date.isoformat().split("T")[0]
