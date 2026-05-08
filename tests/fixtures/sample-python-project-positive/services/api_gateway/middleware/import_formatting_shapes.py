"""import-formatting shapes that should NOT fire.

Imports placed after:
- `with warnings.catch_warnings(): warnings.simplefilter(...)` —
  suppresses import-time DeprecationWarning from upstream packages.
- `__path__ = pkgutil.extend_path(...)` — namespace-package setup
  that must run before submodule imports.
"""

import pkgutil
import warnings

__path__ = pkgutil.extend_path(__path__, __name__)

with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)

from typing import Optional


def has_value(x: Optional[str]) -> bool:
    """Return True if ``x`` is a non-empty string."""
    return bool(x)
