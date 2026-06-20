"""Minimal config-schema DSL for validating environment-driven settings.

A `Selector` models a closed, mutually-exclusive set of option keys — exactly
one of the keys may be supplied — which is how the app expresses "pick one of
these alternatives" config blocks. `merge_dicts` assembles a schema from
reusable fragments so common option groups can be shared across schemas.
"""

from collections.abc import Mapping


def merge_dicts(*fragments: Mapping) -> dict:
    """Shallow-merge schema fragments left-to-right into a single dict."""
    merged: dict = {}
    for fragment in fragments:
        merged.update(fragment)
    return merged


class Selector:
    """A config schema accepting exactly one of the provided option keys."""

    def __init__(self, fields: Mapping) -> None:
        self.fields = dict(fields)
