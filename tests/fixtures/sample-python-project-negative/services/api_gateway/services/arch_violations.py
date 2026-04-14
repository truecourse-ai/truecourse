"""Service module with architecture violations."""
import os
import json
import os
from typing import Dict, List, Optional
from datetime import datetime
from collections import OrderedDict


# VIOLATION: architecture/deterministic/duplicate-import
# (os is imported twice above)

# VIOLATION: architecture/deterministic/unused-import
# (OrderedDict is imported but never used)


# VIOLATION: architecture/deterministic/declarations-in-global-scope
# in expression_statement, so parent is 'expression_statement' not 'module'.
shared_state = {"connections": 0, "last_seen": None}

# VIOLATION: architecture/deterministic/declarations-in-global-scope
request_counter = 0


def get_connection_count() -> int:
    """Return the current connection count."""
    return shared_state["connections"]


def increment_counter() -> int:
    """Increment and return the request counter."""
    global request_counter
    request_counter += 1
    return request_counter


def format_timestamp(dt: Optional[datetime] = None) -> str:
    """Format a datetime as ISO string."""
    if dt is None:
        dt = datetime.utcnow()
    return dt.isoformat()


def load_config(path: str) -> Dict:
    """Load JSON config from file."""
    with open(path) as f:
        return json.load(f)
