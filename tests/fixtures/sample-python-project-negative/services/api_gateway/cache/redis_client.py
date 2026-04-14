import os
import redis

redis_client = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"))


# VIOLATION: style/deterministic/docstring-completeness
def get_cache(key: str) -> str | None:
    return redis_client.get(key)


# VIOLATION: style/deterministic/docstring-completeness
def set_cache(key: str, value: str, ttl: int) -> None:
    redis_client.set(key, value, ex=ttl)
