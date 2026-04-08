"""Metrics collection and aggregation service."""
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class MetricsConfig:
    """Configuration for the metrics service."""

    endpoint: str = "https://metrics.example.com"
    timeout: int = 30


@dataclass
class MetricRecord:
    """A single metric data point."""

    name: str = ""
    value: float = 0.0
    tags: dict = field(default_factory=dict)
