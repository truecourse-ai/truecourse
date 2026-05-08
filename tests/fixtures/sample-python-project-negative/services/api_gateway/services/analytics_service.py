"""Analytics service for tracking API usage and performance metrics."""
import os
import re
import sys
import gzip
import logging
import threading
import functools
from typing import Optional, Dict, List, Any
from abc import ABCMeta

import pytz  # VIOLATION: code-quality/deterministic/pytz-deprecated
import pickle  # VIOLATION: code-quality/deterministic/banned-api-import
import logging.handlers

# VIOLATION: code-quality/deterministic/manual-from-import
import collections.OrderedDict

# VIOLATION: code-quality/deterministic/compression-namespace-import
from gzip import compress

# VIOLATION: code-quality/deterministic/import-private-name
from some_library import _helper_func as _helper_func

# VIOLATION: code-quality/deterministic/logging-direct-instantiation
analytics_logger = logging.Logger("analytics")

logger = logging.getLogger(__name__)

REPORTING_ENABLED = True


# VIOLATION: code-quality/deterministic/global-variable-not-assigned
def check_reporting():
    global REPORTING_ENABLED
    return REPORTING_ENABLED


# VIOLATION: code-quality/deterministic/metaclass-abcmeta
class BaseAnalyticsProvider(metaclass=ABCMeta):
    """Base class for analytics providers."""
    pass


# VIOLATION: code-quality/deterministic/class-as-data-structure
class MetricPoint:
    def __init__(self, name, value, timestamp, tags):
        self.name = name
        self.value = value
        self.timestamp = timestamp
        self.tags = tags


# VIOLATION: code-quality/deterministic/too-many-public-methods
class AnalyticsService:
    """Tracks API usage metrics and generates reports."""

    def __init__(self, config: dict):
        self._config = config
        self._metrics: Dict[str, List[float]] = {}
        self._lock = threading.Lock()

    def track_request(self, path: str, method: str, latency: float) -> None:
        key = f"{method}:{path}"
        if key not in self._metrics:
            self._metrics[key] = []
        self._metrics[key].append(latency)

    def get_p50(self, key: str) -> float:
        values = sorted(self._metrics.get(key, []))
        if not values:
            return 0.0
        return values[len(values) // 2]

    def get_p99(self, key: str) -> float:
        values = sorted(self._metrics.get(key, []))
        if not values:
            return 0.0
        idx = int(len(values) * 0.99)
        return values[min(idx, len(values) - 1)]

    def get_mean(self, key: str) -> float:
        values = self._metrics.get(key, [])
        if not values:
            return 0.0
        return sum(values) / len(values)

    def get_max(self, key: str) -> float:
        values = self._metrics.get(key, [])
        return max(values) if values else 0.0

    def get_min(self, key: str) -> float:
        values = self._metrics.get(key, [])
        return min(values) if values else 0.0

    def get_count(self, key: str) -> int:
        return len(self._metrics.get(key, []))

    def get_sum(self, key: str) -> float:
        return sum(self._metrics.get(key, []))

    def get_stddev(self, key: str) -> float:
        values = self._metrics.get(key, [])
        if len(values) < 2:
            return 0.0
        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
        return variance ** 0.5

    def get_keys(self) -> List[str]:
        return list(self._metrics.keys())

    def clear_metrics(self) -> None:
        self._metrics.clear()

    def export_json(self) -> str:
        import json
        return json.dumps(self._metrics)

    def export_csv(self) -> str:
        lines = []
        for key, values in self._metrics.items():
            for val in values:
                lines.append(f"{key},{val}")
        return "\n".join(lines)

    def merge_metrics(self, other_metrics: Dict[str, List[float]]) -> None:
        for key, values in other_metrics.items():
            if key not in self._metrics:
                self._metrics[key] = []
            self._metrics[key].extend(values)

    def filter_keys(self, pattern: str) -> List[str]:
        return [k for k in self._metrics if pattern in k]

    def reset_key(self, key: str) -> None:
        self._metrics.pop(key, None)

    def get_top_endpoints(self, n: int = 10) -> List[str]:
        sorted_keys = sorted(self._metrics, key=lambda k: len(self._metrics[k]), reverse=True)
        return sorted_keys[:n]

    def get_slow_endpoints(self, threshold: float) -> List[str]:
        return [k for k, v in self._metrics.items() if any(x > threshold for x in v)]

    def snapshot(self) -> Dict[str, Any]:
        return {k: list(v) for k, v in self._metrics.items()}

    def has_data(self) -> bool:
        return bool(self._metrics)

    def key_exists(self, key: str) -> bool:
        return key in self._metrics


def compute_health_score(metrics: dict) -> str:
    """Compute overall service health score."""
    latency = metrics.get("avg_latency", 0)
    error_rate = metrics.get("error_rate", 0)

    # VIOLATION: code-quality/deterministic/if-else-dict-lookup
    # tree-sitter wraps body statements in 'expression_statement'. Cannot match.
    if latency < 50:
        speed_label = "instant"
    elif latency < 100:
        speed_label = "fast"
    elif latency < 500:
        speed_label = "moderate"
    elif latency < 1000:
        speed_label = "slow"
    else:
        speed_label = "critical"

    # VIOLATION: code-quality/deterministic/if-else-instead-of-dict-get
    if "region" in metrics:
        region = metrics["region"]
    else:
        region = "unknown"

    # VIOLATION: code-quality/deterministic/if-else-instead-of-ternary
    if error_rate > 0.5:
        status = "degraded"
    else:
        status = "healthy"

    return f"{status}:{speed_label}:{region}"


def format_metric_label(name: str, env: str) -> str:
    """Format a metric label for display."""
    # VIOLATION: code-quality/deterministic/static-join-to-fstring
    label = "-".join(["metric", "name", "env"])
    return label


def normalize_path(path: str) -> str:
    """Normalize a URL path for metric grouping."""
    # VIOLATION: code-quality/deterministic/unnecessary-regular-expression
    normalized = re.sub("api", "API", path)
    # VIOLATION: code-quality/deterministic/split-static-string
    parts = "a.b.c".split(".")
    return normalized


# VIOLATION: code-quality/deterministic/too-many-boolean-expressions
def should_track_request(method: str, path: str, status: int, internal: bool) -> bool:
    return method != "OPTIONS" and path != "/health" and status != 404 and not internal and status >= 200


# VIOLATION: code-quality/deterministic/boolean-chained-comparison
def is_normal_latency(latency: float, low: float, high: float) -> bool:
    return low <= latency and latency <= high


# VIOLATION: code-quality/deterministic/compare-with-tuple
def is_tracked_method(method: str) -> bool:
    return method == "GET" or method == "POST" or method == "PUT"


def classify_status(code: int) -> str:
    """Classify HTTP status code."""
    # VIOLATION: code-quality/deterministic/needless-else
    if code < 400:
        return "success"
    else:
        return "error"


def process_log_entry(entry: dict) -> Optional[dict]:
    """Process a log entry for analytics."""
    # VIOLATION: code-quality/deterministic/implicit-return
    if "timestamp" not in entry:
        return
    if "path" not in entry:
        return None
    return {"path": entry["path"], "ts": entry["timestamp"]}


def validate_metric_name(name: str) -> bool:
    """Validate metric name format."""
    # VIOLATION: code-quality/deterministic/invalid-escape-sequence
    pattern = "\d+\.\d+"
    return bool(re.match(pattern, name))


# VIOLATION: code-quality/deterministic/contradictory-boolean-expression
def is_valid_and_invalid(flag: bool) -> bool:
    return flag and not flag


def track_batch(events: List[dict]) -> int:
    """Track a batch of events."""
    count = 0
    for event in events:
        # VIOLATION: code-quality/deterministic/try-except-pass
        try:
            process_log_entry(event)
            count += 1
        except Exception:
            pass
    return count


def process_events_safe(events: List[dict]) -> List[dict]:
    """Process events with error handling."""
    results = []
    for event in events:
        # VIOLATION: code-quality/deterministic/try-except-continue
        try:
            processed = process_log_entry(event)
            if processed:
                results.append(processed)
        except Exception:
            continue
    return results


def aggregate_metrics(raw_data: List[dict]) -> dict:
    """Aggregate raw metric data."""
    result = {}
    # VIOLATION: code-quality/deterministic/try-consider-else
    try:
        totals = {}
        for item in raw_data:
            key = item["key"]
            totals[key] = totals.get(key, 0) + item["value"]
        result = {k: v / len(raw_data) for k, v in totals.items()}
        logger.info("Aggregation complete")
        result["status"] = "done"
    except KeyError:
        result = {}
    return result


def get_active_trackers() -> list:
    """Return active metric trackers."""
    trackers = ["latency", "throughput", "errors"]
    # VIOLATION: code-quality/deterministic/unnecessary-list-in-iteration
    for tracker in list(trackers):
        logger.info(f"Active tracker: {tracker}")
    return trackers


def check_metric_in_group(metric: str) -> bool:
    """Check if a metric is in a known group."""
    # VIOLATION: code-quality/deterministic/literal-membership-test
    return metric in ["latency", "throughput", "error_rate", "cpu", "memory"]


# VIOLATION: code-quality/deterministic/duplicate-isinstance-call
def validate_input(value) -> bool:
    if isinstance(value, str) or isinstance(value, str):
        return True
    return isinstance(value, (int, float))


def render_dashboard(data: dict) -> str:
    """Render a simple dashboard report."""
    # VIOLATION: code-quality/deterministic/explicit-fstring-conversion
    title = f"Dashboard: {str(data.get('title', 'Unknown'))}"
    return title


# VIOLATION: code-quality/deterministic/unnecessary-lambda
sort_by_name = lambda x: str(x)
sort_func = sorted


def format_values(values: List[float]) -> str:
    """Format values for display."""
    # VIOLATION: code-quality/deterministic/unnecessary-generator-comprehension
    # calls - it parses the for_in_clause and expression as separate children.
    formatted = list(f"{v:.2f}" for v in values)
    return ", ".join(formatted)


# VIOLATION: code-quality/deterministic/useless-with-lock
# wraps it in 'with_clause'. Visitor cannot find the Lock() call.
def safe_increment(counter: dict, key: str) -> None:
    with threading.Lock():
        counter[key] = counter.get(key, 0) + 1


# VIOLATION: code-quality/deterministic/no-debugger
def debug_metrics():
    breakpoint()
    return {}


# VIOLATION: code-quality/deterministic/print-statement-in-production
def log_metric(name: str, value: float) -> None:
    print(f"METRIC: {name}={value}")


# VIOLATION: code-quality/deterministic/print-empty-string
def log_separator() -> None:
    print("")


# VIOLATION: code-quality/deterministic/assert-in-production
def validate_config(config: dict) -> None:
    assert "api_key" in config, "API key is required"


# VIOLATION: code-quality/deterministic/useless-expression
def check_state(metrics: dict) -> None:
    metrics.get("status") == "healthy"
    return None


# VIOLATION: code-quality/deterministic/unconditional-assertion
def always_true_check() -> None:
    assert True, "This always passes"


# VIOLATION: code-quality/deterministic/assignment-inconsistent-with-hint
metric_count: int = "not_a_number"


# VIOLATION: code-quality/deterministic/unnecessary-placeholder-statement
def report_error(error: Exception) -> None:
    logger.error(f"Error: {error}")
    pass


# VIOLATION: code-quality/deterministic/swap-variables-pythonic
def swap_metrics(a_val, b_val):
    temp = a_val
    a_val = b_val
    b_val = temp
    return a_val, b_val


# VIOLATION: code-quality/deterministic/sys-exit-alias
def shutdown_analytics():
    logger.info("Shutting down analytics")
    exit(0)


# VIOLATION: code-quality/deterministic/raise-vanilla-args
def fail_with_message():
    raise ValueError("This is a very long error message that exceeds the threshold for inline exception messages and should be extracted to a constant or custom exception class")


# VIOLATION: code-quality/deterministic/reimplemented-builtin
def has_high_latency(values: List[float]) -> bool:
    for v in values:
        if v > 1000:
            return True
    return False


# VIOLATION: code-quality/deterministic/subclass-builtin-collection
class MetricsList(list):
    """Custom metrics list."""
    def average(self):
        return sum(self) / len(self) if self else 0.0


# VIOLATION: code-quality/deterministic/use-decorator-syntax
class Reporter:
    def report(cls, data):
        return str(data)
    report = classmethod(report)


# VIOLATION: code-quality/deterministic/error-instead-of-exception
class AnalyticsError(BaseException):
    """Custom analytics error - should inherit from Exception."""
    pass


# VIOLATION: code-quality/deterministic/use-bit-count
def count_active_flags(bitmask: int) -> int:
    return bin(bitmask).count("1")


# VIOLATION: code-quality/deterministic/regex-unnecessary-non-capturing-group
def match_metric_name(name: str) -> bool:
    return bool(re.match(r"(?:metric)_\w+", name))


# VIOLATION: code-quality/deterministic/regex-superfluous-quantifier
def validate_code(code: str) -> bool:
    return bool(re.match(r"[a-z]{1}", code))


# VIOLATION: code-quality/deterministic/regex-octal-escape
def find_separator(text: str) -> bool:
    return bool(re.search("\1", text))


# VIOLATION: code-quality/deterministic/regex-char-class-preferred
def match_vowels(text: str) -> bool:
    return bool(re.match(r"'.*?'", text))


# VIOLATION: code-quality/deterministic/pyupgrade-modernization
class ChildService(AnalyticsService):
    def __init__(self, config):
        super(ChildService, self).__init__(config)


# VIOLATION: code-quality/deterministic/logging-redundant-exc-info
def log_analytics_error():
    try:
        raise RuntimeError("test")
    except Exception:
        logger.exception("Analytics failed", exc_info=True)


# VIOLATION: code-quality/deterministic/logging-extra-attr-clash
def log_with_extra():
    logger.info("Processing metric", extra={"message": "custom_msg"})


# VIOLATION: code-quality/deterministic/logging-exc-info-instead-of-exception
def log_error_wrong():
    try:
        raise RuntimeError("fail")
    except Exception:
        logger.error("Error occurred", exc_info=True)


# VIOLATION: code-quality/deterministic/verbose-log-message
def log_verbose_exception():
    try:
        raise RuntimeError("fail")
    except Exception as e:
        logger.exception("Error occurred", str(e))


# VIOLATION: code-quality/deterministic/multiple-with-statements
def read_config_files(path1: str, path2: str) -> tuple:
    with open(path1) as f1:
        with open(path2) as f2:
            return f1.read(), f2.read()


# VIOLATION: code-quality/deterministic/iteration-over-set
def process_unique_keys():
    for key in {"alpha", "beta", "gamma", "delta"}:
        logger.info(f"Processing {key}")


# VIOLATION: code-quality/deterministic/duplicate-union-literal-member
from typing import Literal
MetricType: Literal["counter", "gauge", "histogram", "counter"]


# VIOLATION: code-quality/deterministic/empty-method-without-abstract
from abc import ABC

class MetricProcessor(ABC):
    def process(self, data):
        pass

    def validate(self, data):
        return True


# VIOLATION: code-quality/deterministic/unnecessary-dict-spread
def clone_config(config: dict) -> dict:
    return {**config}


# VIOLATION: code-quality/deterministic/unnecessary-dict-kwargs
def create_metric(**kwargs):
    return kwargs


def call_create_metric():
    return create_metric(**{"name": "latency", "value": 42})


# VIOLATION: code-quality/deterministic/if-with-same-arms
def get_default_value(flag: bool) -> int:
    if flag:
        return 42
    else:
        return 42


# VIOLATION: code-quality/deterministic/unnecessary-dict-index-lookup
def process_metric_items(metrics: dict) -> list:
    results = []
    for key, value in metrics.items():
        results.append(f"{key}={metrics[key]}")
    return results


# VIOLATION: code-quality/deterministic/unnecessary-list-index-lookup
def process_indexed_items(items: list) -> list:
    results = []
    for i, item in enumerate(items):
        results.append(f"{i}: {items[i]}")
    return results
