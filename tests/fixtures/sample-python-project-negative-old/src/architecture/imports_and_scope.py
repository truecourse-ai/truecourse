"""Architecture violations: imports, scope, and module structure."""
import os
import json
# VIOLATION: architecture/deterministic/duplicate-import
import os

# VIOLATION: architecture/deterministic/unused-import
from pathlib import Path

# SKIP: architecture/deterministic/declarations-in-global-scope
mutable_state = {"count": 0}


def use_os():
    return os.getcwd()


def use_json():
    return json.dumps({})
