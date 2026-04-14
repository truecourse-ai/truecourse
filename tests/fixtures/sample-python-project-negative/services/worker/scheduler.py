"""Task scheduler for the worker service with various bug patterns."""
import os
import re
import sys
import math
import time
import logging
import datetime
import subprocess
import itertools
from decimal import Decimal
from collections import defaultdict
from pathlib import Path
from contextvars import ContextVar
from itertools import groupby

logger = logging.getLogger(__file__)  # VIOLATION: bugs/deterministic/logging-invalid-getlogger


# VIOLATION: bugs/deterministic/shared-mutable-module-state
active_jobs = []

# VIOLATION: bugs/deterministic/global-at-module-level
global scheduler_running


# VIOLATION: bugs/deterministic/assignment-to-os-environ
def init_scheduler_env():
    os.environ = {"SCHEDULER_MODE": "production", "TZ": "UTC"}


# VIOLATION: bugs/deterministic/lowercase-environment-variable
def get_scheduler_secret():
    return os.environ["scheduler_api_key"]


# VIOLATION: bugs/deterministic/invalid-envvar-value
def get_worker_count():
    return os.getenv(8)


# VIOLATION: bugs/deterministic/mutable-contextvar-default
job_context: ContextVar = ContextVar("job_context", default=[])


# VIOLATION: bugs/deterministic/datetime-without-timezone
def get_next_run_time():
    return datetime.datetime.now() + datetime.timedelta(hours=1)


# VIOLATION: bugs/deterministic/datetime-12h-format-without-ampm
def format_schedule_time(dt):
    return dt.strftime("%I:%M:%S %Y-%m-%d")


# VIOLATION: bugs/deterministic/datetime-constructor-range
def create_maintenance_window():
    return datetime.datetime(2024, 6, 31, 25, 0, 0)


# VIOLATION: bugs/deterministic/datetime-min-max
def get_schedule_bounds():
    return datetime.datetime.min, datetime.datetime.max


# VIOLATION: bugs/deterministic/decimal-from-float
def compute_job_cost():
    return Decimal(3.14) * Decimal(2.71)


# VIOLATION: bugs/deterministic/bad-open-mode
def read_schedule_config():
    with open("/etc/scheduler.conf", "wrt") as f:
        return f.read()


# VIOLATION: bugs/deterministic/subprocess-popen-preexec-fn
def run_job_script(script):
    proc = subprocess.Popen(
        ["bash", script],
        preexec_fn=os.setsid,
        stdout=subprocess.PIPE,
    )
    return proc.wait()


# VIOLATION: bugs/deterministic/os-path-commonprefix-bug
def validate_job_path(job_path, base_dir):
    common = os.path.commonprefix([job_path, base_dir])
    if common != base_dir:
        raise ValueError("Job path outside allowed directory")


# VIOLATION: bugs/deterministic/invalid-pathlib-with-suffix
def get_log_file(job_name):
    return Path(f"/var/log/scheduler/{job_name}").with_suffix("log")


# VIOLATION: bugs/deterministic/logging-args-mismatch
def log_job_execution(job_name, status, duration, node_id):
    logger.info("Job %s completed with status %s in %s on node %s and queue %s",
                job_name, status, duration)


# VIOLATION: bugs/deterministic/logging-exception-no-exc-info
def log_scheduler_error():
    logger.exception("Scheduler encountered an error")


# VIOLATION: bugs/deterministic/defaultdict-default-factory-kwarg
def build_job_index():
    return defaultdict(default_factory=list)


# VIOLATION: bugs/deterministic/dict-index-missing-items
class JobConfigStore:
    def __init__(self):
        self._data = {}

    def __getitem__(self, key):
        return self._data[key]


# VIOLATION: bugs/deterministic/duplicate-keys
SCHEDULER_DEFAULTS = {
    "max_retries": 3,
    "timeout": 300,
    "max_retries": 5,
}


# VIOLATION: bugs/deterministic/static-key-dict-comprehension-ruff
def build_constant_map(values):
    return {"schedule": v for v in values}


# VIOLATION: bugs/deterministic/mutable-fromkeys-value
def init_queue_buckets(queue_names):
    return dict.fromkeys(queue_names, [])


# VIOLATION: bugs/deterministic/in-empty-collection
def is_priority_job(job_name):
    return job_name in set()


# VIOLATION: bugs/deterministic/incompatible-operator-types
def compute_priority():
    return "high" - "low"


# VIOLATION: bugs/deterministic/comparison-to-none-constant
def check_job(job):
    if Schedule() is None:
        return "no schedule"
    return job


# VIOLATION: bugs/deterministic/new-object-identity-check
def has_config(config):
    if SchedulerConfig() is config:
        return True


# VIOLATION: bugs/deterministic/identity-with-dissimilar-types
def check_id(job_id):
    return 42 is "default"


# VIOLATION: bugs/deterministic/batched-without-strict
def process_job_batches(jobs):
    for batch in itertools.batched(jobs, 50):
        _execute_batch(batch)


# VIOLATION: bugs/deterministic/zip-without-strict
def assign_jobs_to_workers(jobs, workers):
    return list(zip(jobs, workers))


# VIOLATION: bugs/deterministic/map-without-strict
def apply_priorities(jobs, weights, multipliers):
    return list(map(lambda j, w, m: (j, w * m), jobs, weights, multipliers))


# VIOLATION: bugs/deterministic/math-isclose-zero-no-abstol
def is_zero_cost(cost):
    return math.isclose(cost, 0.0)


# VIOLATION: bugs/deterministic/regex-backreference-invalid
def validate_cron_expr(expr):
    return re.match(r"(\d+)\s(\d+)\s\3", expr)


# VIOLATION: bugs/deterministic/regex-boundary-unmatchable
def match_job_prefix(name):
    return re.match(r"$job_", name)


# VIOLATION: bugs/deterministic/regex-group-reference-mismatch-python
def normalize_schedule(schedule):
    return re.sub(r"(every)\s(day)", r"\3", schedule)


# VIOLATION: bugs/deterministic/regex-lookahead-contradictory
def validate_job_name(name):
    return re.search(r"(?=worker)(?!worker)", name)


# VIOLATION: bugs/deterministic/regex-possessive-always-fails
def match_repeating_ids(text):
    return re.search(r"x++x", text)


# VIOLATION: bugs/deterministic/empty-character-class
def strip_job_markers(text):
    return re.sub(r"[]", "", text)


# VIOLATION: bugs/deterministic/forward-annotation-syntax-error
def configure_schedule(config: "Dict[str") -> None:
    pass


# VIOLATION: bugs/deterministic/fstring-in-gettext
def translate_status(status):
    from gettext import gettext as _
    return _(f"Job status: {status}")


# VIOLATION: bugs/deterministic/function-call-in-default-argument
def schedule_job(name, cron=parse_cron("0 * * * *")):
    return {"name": name, "cron": cron}


# VIOLATION: bugs/deterministic/loop-variable-overrides-iterator
def process_job_list(jobs):
    for jobs in range(len(jobs)):
        pass


# VIOLATION: bugs/deterministic/loop-at-most-one-iteration
def get_first_pending(jobs):
    for job in jobs:
        return job


# VIOLATION: bugs/deterministic/reuse-groupby-generator
def group_by_status(jobs):
    sorted_jobs = sorted(jobs, key=lambda j: j["status"])
    for status, group in groupby(sorted_jobs, key=lambda j: j["status"]):
        first = list(group)
        second = list(group)
        yield status, first, second


# VIOLATION: bugs/deterministic/loop-variable-overrides-iterator
def double_process(items):
    for items in items:
        pass


class Schedule:
    pass


class SchedulerConfig:
    pass


def _execute_batch(batch):
    pass


def parse_cron(expr):
    return expr
