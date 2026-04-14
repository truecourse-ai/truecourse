"""Rate limiting middleware for API gateway."""
import time
import hashlib
from typing import Optional, Dict
from flask import request


# VIOLATION: style/deterministic/docstring-completeness
class RateLimiter:
    def __init__(self, max_requests: int = 100, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._store: Dict[str, list] = {}

    # VIOLATION: style/deterministic/docstring-completeness
    # VIOLATION: code-quality/deterministic/no-self-use
    # VIOLATION: code-quality/deterministic/missing-type-hints
    def get_client_key(self, req):
        ip = req.remote_addr or "unknown"
        # VIOLATION: security/deterministic/weak-hashing
        return hashlib.md5(ip.encode()).hexdigest()

    # VIOLATION: style/deterministic/docstring-completeness
    def is_rate_limited(self, client_key: str) -> bool:
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

    # VIOLATION: style/deterministic/docstring-completeness
    def get_remaining(self, client_key: str) -> int:
        if client_key not in self._store:
            return self.max_requests
        return self.max_requests - len(self._store[client_key])

    # VIOLATION: style/deterministic/docstring-completeness
    def clear_expired(self) -> None:
        now = time.time()
        window_start = now - self.window_seconds
        for key in list(self._store.keys()):
            self._store[key] = [
                t for t in self._store[key] if t > window_start
            ]
            if not self._store[key]:
                del self._store[key]


# VIOLATION: style/deterministic/docstring-completeness
# VIOLATION: code-quality/deterministic/missing-type-hints
def create_limiter(max_req=100, window=60):
    return RateLimiter(max_req, window)
