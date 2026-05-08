"""commented-out-code shapes that should NOT fire.

- Value-legend comments: ``# False = not migrated, True = migrated``,
  ``# None = undecided`` — prose explaining what literal values mean
  in the surrounding column / flag, not commented-out code.
- Prose illustration blocks: ``# For example, given a structure: ...``
  / ``# yields the following`` — natural-language documentation.
"""


def is_migrated(flag: bool) -> str:
    """Return human-readable migration state.

    For example, given a flag value, the function yields a label.
    """
    # False = not migrated, True = migrated
    return "migrated" if flag else "pending"


def consent(state: object) -> bool:
    """Return whether ``state`` represents an explicit consent.

    For example, given a structure {"consent": True}, this yields True.
    """
    # None = undecided = not consented (same logic as auth.py)
    if state is None:
        return False
    return bool(state)
