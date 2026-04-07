import time


class HealthService:
    def check(self) -> dict:
        return {
            "status": "ok",
            "uptime": time.monotonic(),
        }
