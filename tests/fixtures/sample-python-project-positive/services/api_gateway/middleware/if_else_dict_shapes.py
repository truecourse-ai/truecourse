"""if-else-dict-lookup shape that should NOT fire.

Branch bodies that assign the result of a method-chain call —
each call has different arguments / shapes, and the dict-lookup
rewrite (`qs = {"asc": qs.order_by("name"), ...}[order]`) would
evaluate every branch eagerly. The if/elif chain is required to
choose ONE branch to evaluate.
"""

class QuerySet:
    """Stand-in for a query-builder."""

    def order_by(self, *fields: str) -> "QuerySet":
        """Return a new query ordered by the given fields."""
        return self


def apply_sort(qs: QuerySet, order: str) -> QuerySet:
    """Apply the requested sort order to ``qs``."""
    if order == "asc":
        qs = qs.order_by("name")
    elif order == "desc":
        qs = qs.order_by("-name")
    elif order == "newest":
        qs = qs.order_by("-created_at", "-id")
    elif order == "oldest":
        qs = qs.order_by("created_at", "id")
    else:
        qs = qs.order_by("id")
    return qs
