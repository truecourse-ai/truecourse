"""Data flow bugs that trigger undefined variable detection."""
import logging

logger = logging.getLogger(__name__)


# VIOLATION: bugs/deterministic/undefined-local-variable
def process_data(items):
    print(result)
    result = []
    for item in items:
        result.append(item)
    return result


# VIOLATION: bugs/deterministic/undefined-name
def transform_data(data):
    return nonexistent_transform(data)


def compute_stats(values):
    # VIOLATION: bugs/deterministic/undefined-local-variable
    total = running_sum + values[0]
    running_sum = 0
    for v in values:
        running_sum += v
    return total
