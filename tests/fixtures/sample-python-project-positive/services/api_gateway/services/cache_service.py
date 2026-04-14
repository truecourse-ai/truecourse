"""Cache service for API gateway with expiration support."""
import re
import time
import logging

import requests

logger = logging.getLogger(__name__)

MAX_KEY_LENGTH = 256
HTTP_OK = 200
HTTP_TIMEOUT = 30
FIELD_EXPIRES = "expires"
FIELD_VALUE = "value"


class CacheService:
    """Manages in-memory cache with expiration support."""

    def __init__(self, ttl: int = 300) -> None:
        self.ttl = ttl
        self._store: dict[str, dict] = {}
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> object | None:
        """Retrieve a cached value by key."""
        entry = self._store.get(key)
        if not entry:
            self._misses += 1
            return None
        if time.time() > entry[FIELD_EXPIRES]:
            del self._store[key]
            self._misses += 1
            return None
        self._hits += 1
        return entry[FIELD_VALUE]

    def set(self, key: str, value: object, ttl: int | None = None) -> None:
        """Store a value in the cache with optional TTL."""
        self._store[key] = {
            FIELD_VALUE: value,
            FIELD_EXPIRES: time.time() + (ttl or self.ttl),
        }

    def delete(self, key: str) -> bool:
        """Delete a cached entry by key."""
        if key in self._store:
            del self._store[key]
            return True
        return False

    def validate_key(self, key: str) -> bool:
        """Validate that a cache key meets format requirements."""
        if len(key) > MAX_KEY_LENGTH:
            self._misses += 1
            return False
        return bool(re.match(r"^[\w:.-]+$", key))

    def evict_expired(self) -> int:
        """Remove all expired entries from the cache."""
        now = time.time()
        expired_keys = [k for k, v in self._store.items() if now > v[FIELD_EXPIRES]]
        for key in expired_keys:
            del self._store[key]
        return len(expired_keys)

    def get_hit_rate(self) -> float:
        """Calculate the cache hit rate."""
        total = self._hits + self._misses
        if total == 0:
            return 0.0
        return self._hits / total

    def clear(self) -> None:
        """Clear all cache entries and reset counters."""
        self._store.clear()
        self._hits = 0
        self._misses = 0


class CacheWarmer:
    """Pre-loads frequently accessed data into cache."""

    def __init__(self, cache: CacheService) -> None:
        self._cache = cache

    def warm_from_api(self, url: str, key: str) -> bool:
        """Warm cache with data from an API endpoint."""
        response = requests.get(url, timeout=HTTP_TIMEOUT)
        if response.status_code == HTTP_OK:
            self._cache.set(key, response.json())
            return True
        return False


def create_cache(ttl: int = 300) -> CacheService:
    """Create a new cache service instance."""
    return CacheService(ttl)


def cache_key_for(resource: str, resource_id: str) -> str:
    """Generate a cache key for a resource."""
    return f"{resource}:{resource_id}"
