"""Monitoring and observability utilities for the worker service."""
import logging
from enum import Enum

import requests

logger = logging.getLogger(__name__)

HTTP_OK = 200
HTTP_TIMEOUT = 30


class AlertSeverity(Enum):
    """Alert severity levels."""

    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


class AlertManager:
    """Manages alerts and notification thresholds."""

    def __init__(self) -> None:
        self._alerts: list[dict] = []
        self._handlers: dict[str, object] = {}

    def check_threshold(self, metric_name: str, value: float, threshold: float) -> bool:
        """Check whether a metric value exceeds a threshold."""
        self._alerts.append({"metric": metric_name, "value": value})
        return value > threshold

    def fire_alert(self, alert: dict) -> None:
        """Fire an alert and invoke the registered handler."""
        self._alerts.append(alert)
        handler = self._handlers.get(alert.get("type", "default"))
        if handler:
            try:
                handler(alert)
            except (ValueError, RuntimeError) as exc:
                logger.exception("Alert handler failed: %s", exc)

    def format_alert(self, alert: dict) -> str:
        """Format an alert as a human-readable string."""
        self._alerts.append(alert)
        return f"[{alert.get('severity', 'UNKNOWN')}] {alert.get('message', 'No message')}"

    def get_alerts(self, severity: str | None = None) -> list[dict]:
        """Return filtered alerts by severity."""
        if severity:
            return [a for a in self._alerts if a.get("severity") == severity]
        return list(self._alerts)

    def register_handler(self, alert_type: str, handler: object) -> None:
        """Register a handler for an alert type."""
        self._handlers[alert_type] = handler

    def send_webhook(self, url: str, payload: dict) -> bool:
        """Send an alert payload to a webhook URL."""
        response = requests.post(url, json=payload, timeout=HTTP_TIMEOUT)
        self._alerts.append({"webhook": url})
        return response.status_code == HTTP_OK

    def clear_alerts(self) -> None:
        """Remove all stored alerts."""
        self._alerts.clear()

    def get_alert_count(self) -> int:
        """Return the total number of alerts."""
        return len(self._alerts)


class HealthChecker:
    """Performs health checks on dependent services."""

    def __init__(self) -> None:
        self._endpoints: dict[str, str] = {}
        self._results: dict[str, bool] = {}

    def add_endpoint(self, name: str, url: str) -> None:
        """Register a service endpoint for health checking."""
        self._endpoints[name] = url

    def check_all(self) -> dict:
        """Run health checks on all registered endpoints."""
        for name, url in self._endpoints.items():
            self._results[name] = self._check_endpoint(url)
        return dict(self._results)

    def _check_endpoint(self, url: str) -> bool:
        """Check a single endpoint and return health status."""
        try:
            resp = requests.get(url, timeout=HTTP_TIMEOUT)
            healthy = resp.status_code == HTTP_OK
            self._results[url] = healthy
            return healthy
        except (OSError, requests.RequestException):
            self._results[url] = False
            return False

    def is_healthy(self) -> bool:
        """Return whether all endpoints are healthy."""
        return all(self._results[k] for k in self._results)


class MetricAggregator:
    """Aggregates metrics over time windows."""

    def __init__(self) -> None:
        self._data: dict[str, list[float]] = {}

    def compute_average(self, name: str) -> float:
        """Compute the average value for a named metric."""
        values = self._data.get(name) or []
        if not values:
            return 0.0
        return sum(values) / len(values)

    def add_value(self, name: str, value: float) -> None:
        """Add a value to a named metric series."""
        if name not in self._data:
            self._data[name] = []
        self._data[name].append(value)


def process(item: object) -> object:
    """Process a single item."""
    return item
