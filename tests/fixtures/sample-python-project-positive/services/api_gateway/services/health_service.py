"""Health check service for the API gateway."""
import time


class HealthService:
    """Provides health check status for the service."""

    def __init__(self) -> None:
        self._start_time = time.monotonic()

    def check(self) -> dict:
        """Return current service health status."""
        return {
            "status": "ok",
            "uptime": time.monotonic() - self._start_time,
        }
