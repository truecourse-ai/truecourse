import time


# VIOLATION: style/deterministic/docstring-completeness
class HealthService:
    # VIOLATION: style/deterministic/docstring-completeness
    def check(self) -> dict:
        return {
            "status": "ok",
            "uptime": time.monotonic(),
        }
