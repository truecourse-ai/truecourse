"""Bug violations that only trigger in .pyi stub files."""
import sys

# VIOLATION: bugs/deterministic/type-stub-version-check-error
if sys.version_info > (3, 10):
    pass

# VIOLATION: bugs/deterministic/type-stub-annotation-error
class MyClass:
    def __enter__(self) -> MyClass: ...
