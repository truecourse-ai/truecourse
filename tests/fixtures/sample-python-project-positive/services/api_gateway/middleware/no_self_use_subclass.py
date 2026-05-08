"""Methods on subclasses sometimes don't need self even though
they're part of a class contract — the base class enforces the
shape and the body just doesn't happen to read instance state.

Two FP shapes the rule should ignore:

1. Method on a class with a non-trivial base — could be an
   override / interface implementation that the analyzer can't
   trace through.
2. Private method (`_`-prefixed) — class-internal helper kept
   on the class for namespacing; converting to staticmethod
   adds zero value and breaks call-site readability.

Positive fixture: NO no-self-use violations should fire.
"""

from __future__ import annotations


class _Base:
    """Hypothetical base class with required method shape."""

    def __init__(self, threshold: int = 0) -> None:
        """Track a base threshold."""
        self.threshold = threshold

    def filter(self, value: int) -> bool:
        """Default filter."""
        return value >= self.threshold


_ALLOW_ZERO_AND_POSITIVE = 0


class Concrete(_Base):
    """Subclass that overrides the contract method but happens
    not to use self in the body — e.g., a stateless filter.
    """

    def filter(self, value: int) -> bool:  # noqa: A003 - override
        """Pass-through filter — doesn't need self."""
        return value >= _ALLOW_ZERO_AND_POSITIVE


_EMPTY_MESSAGE_ERROR = "empty"


class _Manager:
    def _confirm_source(self, message: str) -> None:
        """Private guard helper — kept on the class for namespacing."""
        if not message:
            raise ValueError(_EMPTY_MESSAGE_ERROR)

    def _format_payload(self, payload: dict) -> dict:
        """Private formatter helper."""
        return {"payload": payload}
