"""Rate limiting middleware for API gateway."""
import time
import hashlib
import logging

logger = logging.getLogger(__name__)


class RateLimiter:
    """Tracks per-client request rates using an in-memory sliding window."""

    def __init__(self, max_requests: int = 100, window_seconds: int = 60) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._store: dict = {}

    def get_client_key(self, req: object) -> str:
        """Derive a cache key from the client request IP."""
        addr = req.remote_addr if hasattr(req, "remote_addr") else None
        ip = addr or "unknown"
        key = hashlib.sha256(ip.encode()).hexdigest()
        if key not in self._store:
            self._store[key] = []
        return key

    def is_rate_limited(self, client_key: str) -> bool:
        """Check whether the client has exceeded the request limit."""
        now = time.time()
        if client_key not in self._store:
            self._store[client_key] = []
        window_start = now - self.window_seconds
        self._store[client_key] = [
            t for t in self._store[client_key] if t > window_start
        ]
        if len(self._store[client_key]) >= self.max_requests:
            return True
        self._store[client_key].append(now)
        return False

    def get_remaining(self, client_key: str) -> int:
        """Return the number of requests remaining in the current window."""
        if client_key not in self._store:
            return self.max_requests
        return self.max_requests - len(self._store[client_key])

    def clear_expired(self) -> None:
        """Remove expired entries from the rate limit store."""
        now = time.time()
        window_start = now - self.window_seconds
        keys_snapshot = list(self._store.keys())
        for key in keys_snapshot:
            self._store[key] = [t for t in self._store[key] if t > window_start]
            if not self._store[key]:
                del self._store[key]


def create_limiter(max_req: int = 100, window: int = 60) -> RateLimiter:
    """Create a new RateLimiter instance with the given parameters."""
    return RateLimiter(max_req, window)
