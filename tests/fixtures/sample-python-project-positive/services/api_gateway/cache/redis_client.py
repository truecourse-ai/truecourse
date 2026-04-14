"""Redis cache client for the API gateway."""
from __future__ import annotations

import os
import redis

redis_client = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"))


def get_cache(key: str) -> str | None:
    """Retrieve a value from the Redis cache by key."""
    return redis_client.get(key)


def set_cache(key: str, value: str, ttl: int) -> None:
    """Store a value in the Redis cache with a TTL."""
    redis_client.set(key, value, ex=ttl)
