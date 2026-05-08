"""unnecessary-list-in-iteration shape that should NOT fire.

`for key in list(mapping):` is required when the loop body
mutates ``mapping`` (pop / del / setitem). Iterating the dict
directly while mutating it raises ``RuntimeError: dictionary
changed size during iteration``.
"""


def filter_kwargs(kwargs: dict) -> dict:
    """Drop falsy values from ``kwargs`` in place and return it."""
    for key in list(kwargs):
        if not kwargs[key]:
            del kwargs[key]
    return kwargs
