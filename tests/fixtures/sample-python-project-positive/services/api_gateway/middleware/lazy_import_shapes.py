"""import-outside-top-level shapes that should NOT fire:
- Top-level function with a function-local import (circular
  break, lazy-load, optional dep).
- Function inside a `try/except ImportError` (already handled).
"""

from __future__ import annotations


def expensive_handler(payload: dict) -> dict:
    """Top-level function uses a function-local import to avoid
    importing a heavyweight module at startup.
    """
    from openhands.app_server.services.injector import InjectorState  # noqa: F401

    return {"ok": True, "payload": payload}


def break_cycle(name: str) -> str:
    """Function-local import to break a circular dependency
    between domain modules.
    """
    from services.user_service.repositories.profile_repository import ProfileRepository

    return f"{name}:{ProfileRepository.__name__}"


def use_optional_dep() -> str:
    """Optional dependency: import lives inside a try/except so
    the module loads even when the package is missing.
    """
    try:
        import optional_lib  # type: ignore[import-not-found]
        return optional_lib.name
    except ImportError:
        return "fallback"
