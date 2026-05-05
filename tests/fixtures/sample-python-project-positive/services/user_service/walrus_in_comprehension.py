"""Walrus operator inside the `if` clause of dict comprehensions spread
via `**` into an outer dict literal — the exact shape that produced the
FP in OpenHands' enterprise/storage/saas_settings_store.py.

PEP 572: the assignment binds at the enclosing function scope before the
comprehension's expression evaluates each branch, so the use of `normalized`
in the key position is correct even though it appears textually before
the `:=`. The undefined-local-variable rule must not flag this.
"""

from collections.abc import Iterable


def merge_settings(org_columns: Iterable[object], user_columns: Iterable[object], allowed: set[str]) -> dict[str, object]:
    """Build a merged kwargs dict from two column groups."""
    return {
        **{
            normalized: org_columns
            for c in org_columns
            if (
                normalized := str(c).removeprefix('_default_')
                .removeprefix('default_')
                .lstrip('_')
            )
            in allowed
        },
        **{
            normalized: user_columns
            for c in user_columns
            if (normalized := str(c).lstrip('_')) in allowed
        },
    }
