"""In-memory fixed-window rate limiter used as a single-instance backstop.

The production gateway enforces the real limit; this guards a single process.
"""

import time

# Per-client request ceiling. Chosen to match the upstream gateway's burst
# allowance, but it lives only in code — no spec, ADR, or runbook records it.
RATE_LIMIT_PER_MINUTE = 100

_hits: dict[str, tuple[int, float]] = {}


def allow(client_id: str) -> bool:
    now = time.time()
    count, reset_at = _hits.get(client_id, (0, 0.0))
    if reset_at < now:
        _hits[client_id] = (1, now + 60.0)
        return True
    if count >= RATE_LIMIT_PER_MINUTE:
        return False
    _hits[client_id] = (count + 1, reset_at)
    return True
