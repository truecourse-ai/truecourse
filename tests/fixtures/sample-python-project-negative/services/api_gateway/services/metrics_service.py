"""Metrics collection and aggregation service."""
import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Iterable
from enum import Enum

logger = logging.getLogger(__name__)


# VIOLATION: bugs/deterministic/dataclass-enum-conflict
@dataclass
class MetricType(Enum):
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"


# VIOLATION: bugs/deterministic/implicit-classvar-in-dataclass
# 'expression_statement > assignment' with a type annotation. No annotated_assignment type exists.
@dataclass
class MetricsConfig:
    MAX_BATCH_SIZE: int = 1000
    endpoint: str = "https://metrics.example.com"
    timeout: int = 30


# VIOLATION: bugs/deterministic/post-init-default
@dataclass
class MetricRecord:
    name: str
    value: float
    tags: dict = field(default_factory=dict)

    def __post_init__(self, timestamp=None):
        if timestamp is None:
            self.timestamp = time.time()
        else:
            self.timestamp = timestamp


# VIOLATION: bugs/deterministic/duplicate-class-members
class MetricCollector:
    def collect(self):
        return self._buffer

    def process(self, data):
        self._buffer.append(data)

    def collect(self):
        self._buffer.clear()
        return []


# VIOLATION: bugs/deterministic/duplicate-base-classes
class MetricsHandler(MetricCollector, MetricCollector):
    pass


# VIOLATION: bugs/deterministic/members-differ-only-by-case
class ReportBuilder:
    def buildReport(self):
        return {}

    def buildreport(self):
        return {}


# VIOLATION: bugs/deterministic/property-without-return
class MetricAggregator:
    @property
    def total(self):
        self._compute_total()

    def _compute_total(self):
        pass


# VIOLATION: bugs/deterministic/property-param-count-wrong
class MetricStore:
    @property
    def count(self, include_deleted=False):
        return len(self._items)

    def __init__(self):
        self._items = []


# VIOLATION: bugs/deterministic/getter-missing-return
class CacheStats:
    @property
    def hit_rate(self):
        pass


# VIOLATION: bugs/deterministic/self-or-cls-assignment
class EventProcessor:
    def process(self, event):
        self = event.processor
        return event


# VIOLATION: bugs/deterministic/method-override-contract-change
class BaseExporter:
    def export(self, data, format="json"):
        pass


class CSVExporter(BaseExporter):
    def export(self, data):
        pass


# VIOLATION: bugs/deterministic/invalid-special-method-return-type
class MetricBatch:
    def __len__(self):
        return "unknown"

    def __bool__(self):
        return 1

    def __str__(self):
        return 42

    def __init__(self):
        self._items = []


# VIOLATION: bugs/deterministic/async-function-with-timeout
async def fetch_remote_metrics(endpoint, timeout=30):
    return await asyncio.get_event_loop().run_in_executor(None, lambda: None)


# VIOLATION: bugs/deterministic/cancel-scope-no-checkpoint
async def process_metric_batch(batch):
    async with asyncio.timeout(10):
        total = sum(m.value for m in batch)
        return total


# VIOLATION: bugs/deterministic/cancellation-exception-not-reraised
async def safe_export(exporter, data):
    try:
        await exporter.export(data)
    except asyncio.CancelledError:
        logger.warning("Export was cancelled")


# VIOLATION: bugs/deterministic/control-flow-in-task-group
async def parallel_aggregate(metric_groups):
    async with asyncio.TaskGroup() as tg:
        for group in metric_groups:
            tg.create_task(process_group(group))
            if group.is_final:
                return


# VIOLATION: bugs/deterministic/redefined-slots-in-subclass
class BaseMetric:
    __slots__ = ('name', 'value')


class TimedMetric(BaseMetric):
    __slots__ = ('name', 'timestamp')


# VIOLATION: bugs/deterministic/yield-in-init
class MetricStream:
    def __init__(self, source):
        self.source = source
        yield from source


async def process_group(group):
    pass
