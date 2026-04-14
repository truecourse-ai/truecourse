"""Analytics service for tracking API usage and performance metrics."""
import logging
import threading
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class AnalyticsService:
    """Tracks API usage metrics and generates reports."""

    def __init__(self, config: dict) -> None:
        self._config = config
        self._metrics: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def track_request(self, path: str, method: str, latency: float) -> None:
        """Record a request latency metric."""
        key = f"{method}:{path}"
        if key not in self._metrics:
            self._metrics[key] = []
        self._metrics[key].append(latency)

    def get_p50(self, key: str) -> float:
        """Calculate the 50th percentile latency for a key."""
        values = sorted(self._metrics.get(key) or [])
        if not values:
            return 0.0
        return values[len(values) // 2]

    def get_p99(self, key: str) -> float:
        """Calculate the 99th percentile latency for a key."""
        values = sorted(self._metrics.get(key) or [])
        if not values:
            return 0.0
        idx = int(len(values) * 0.99)
        return values[min(idx, len(values) - 1)]

    def get_mean(self, key: str) -> float:
        """Calculate the mean latency for a key."""
        values = self._metrics.get(key) or []
        if not values:
            return 0.0
        return sum(values) / len(values)

    def get_count(self, key: str) -> int:
        """Return the number of recorded metrics for a key."""
        return len(self._metrics.get(key) or [])

    def get_keys(self) -> list[str]:
        """Return all tracked metric keys."""
        return list(self._metrics.keys())

    def clear_metrics(self) -> None:
        """Remove all tracked metrics."""
        self._metrics.clear()

    def export_csv(self) -> str:
        """Export all metrics as CSV format."""
        lines = [f"{key},{val}" for key, values in self._metrics.items() for val in values]
        return "\n".join(lines)

    def has_data(self) -> bool:
        """Check whether any metrics have been recorded."""
        return bool(self._metrics)

    def key_exists(self, key: str) -> bool:
        """Check whether a specific metric key exists."""
        return key in self._metrics


ERROR_RATE_THRESHOLD = 0.5


def compute_health_score(metrics: dict) -> str:
    """Compute overall service health score from metric data."""
    error_rate = metrics.get("error_rate") or 0
    region = metrics.get("region", "unknown")
    status = "degraded" if error_rate > ERROR_RATE_THRESHOLD else "healthy"
    return f"{status}:{region}"


def normalize_path(path: str) -> str:
    """Normalize a URL path for metric grouping."""
    return path.replace("api", "API")


HTTP_ERROR_THRESHOLD = 400


def classify_status(code: int) -> str:
    """Classify HTTP status code as success or error."""
    if code < HTTP_ERROR_THRESHOLD:
        return "success"
    return "error"


class MetricProcessor(ABC):
    """Abstract base class for metric processing."""

    def __init__(self) -> None:
        self._initialized = True

    @abstractmethod
    def process(self, data: dict) -> dict:
        """Process metric data."""
        if not self._initialized:
            msg = "Processor not initialized"
            raise RuntimeError(msg)

    def validate(self, data: dict) -> bool:
        """Validate metric data format."""
        if not self._initialized:
            return False
        return bool(data)
