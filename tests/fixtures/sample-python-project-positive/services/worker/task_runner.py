"""Task runner for background processing."""
import os
import logging

import requests

logger = logging.getLogger(__name__)

TASK_TIMEOUT = 30
API_KEY = os.environ.get("API_KEY") or ""
HTTP_OK = 200
HTTP_TIMEOUT = 30


class TaskRunner:
    """Executes registered tasks with error handling."""

    def __init__(self) -> None:
        self._tasks: dict[str, object] = {}
        self._results: dict[str, object] = {}
        self._errors: list[str] = []

    def register_task(self, name: str, handler: object) -> None:
        """Register a named task handler."""
        self._tasks[name] = handler

    def run_task(self, name: str) -> None:
        """Execute a registered task by name."""
        handler = self._tasks.get(name)
        if not handler:
            msg = f"Task not found: {name}"
            raise KeyError(msg)
        try:
            result = handler()
            self._results[name] = result
        except (ValueError, RuntimeError) as exc:
            self._errors.append(f"Task {name} failed: {exc}")

    def fetch_remote_config(self, url: str) -> dict:
        """Fetch configuration from a remote URL."""
        response = requests.get(url, timeout=HTTP_TIMEOUT)
        self._results["remote_config"] = response.status_code
        return response.json()

    def get_results(self) -> dict[str, object]:
        """Return all task execution results."""
        return dict(self._results)

    def get_errors(self) -> list[str]:
        """Return all task execution errors."""
        return list(self._errors)


class MetricsCollector:
    """Collects and reports task execution metrics."""

    def __init__(self) -> None:
        self._metrics: dict[str, list[float]] = {}
        self._counters: dict[str, int] = {}

    def record_duration(self, task_name: str, duration: float) -> None:
        """Record the duration of a task execution."""
        if task_name not in self._metrics:
            self._metrics[task_name] = []
        self._metrics[task_name].append(duration)

    def increment_counter(self, name: str) -> None:
        """Increment a named counter."""
        current = self._counters.get(name)
        self._counters[name] = (current if current is not None else 0) + 1

    def format_report(self, task_name: str) -> str:
        """Format a metric report for a task."""
        count = len(self._metrics.get(task_name) or [])
        return f"Task: {task_name} ({count} executions)"

    def get_average(self, task_name: str) -> float:
        """Calculate the average duration for a task."""
        durations = self._metrics.get(task_name) or []
        if not durations:
            return 0.0
        return sum(durations) / len(durations)


def _check_service_health(url: str) -> bool:
    """Check a single service URL for health."""
    try:
        resp = requests.get(f"{url}/health", timeout=HTTP_TIMEOUT)
        return resp.status_code == HTTP_OK
    except (OSError, requests.RequestException):
        return False


def run_health_check(service_urls: list[str]) -> dict:
    """Run health checks against a list of service URLs."""
    results = {}
    for url in service_urls:
        results[url] = _check_service_health(url)
    return results
