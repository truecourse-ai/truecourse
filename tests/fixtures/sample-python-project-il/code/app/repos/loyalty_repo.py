"""Loyalty-tier lookups — raw SQL, because the eligibility predicate is
composed dynamically from the caller's feature context."""

from app.db import SessionLocal  # noqa: F401


def list_eligible_tiers(db, active_filter):
    # The allowed-tier set [bronze, silver, gold] matches the spec, but the
    # interpolated `active_filter` fragment is opaque to the verifier —
    # surfaced as a coverage gap rather than silently dropped.
    # IL-DRIFT: QueryRule:loyalty-tiers.allowed-tiers / query.unparseable
    return db.execute(
        f"SELECT code, name, threshold FROM loyalty_tiers "
        f"WHERE code IN ('bronze', 'silver', 'gold') AND {active_filter}"
    )
