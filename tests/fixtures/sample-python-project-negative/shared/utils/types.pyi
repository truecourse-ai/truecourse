"""Type stubs for utility functions."""
import sys
from typing import Never


# VIOLATION: bugs/deterministic/type-stub-annotation-error (PYI034)
class Connection:
    def __init__(self) -> Connection: ...
    def __enter__(self) -> Connection: ...
    def __exit__(self, *args) -> None: ...


# VIOLATION: bugs/deterministic/type-stub-annotation-error (PYI050)
class StrictModel:
    def __str__(self) -> Never: ...
    def __repr__(self) -> Never: ...


# VIOLATION: bugs/deterministic/type-stub-version-check-error (PYI003)
if sys.version_info > (3, 10):
    def new_feature() -> str: ...

# VIOLATION: bugs/deterministic/type-stub-version-check-error (PYI008)
if sys.platform != "linux":
    def platform_func() -> str: ...
