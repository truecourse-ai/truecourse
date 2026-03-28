import os
import redis

redis_client = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"))


def get_cache(key: str) -> str | None:
    return redis_client.get(key)


def set_cache(key: str, value: str, ttl: int) -> None:
    redis_client.set(key, value, ex=ttl)
