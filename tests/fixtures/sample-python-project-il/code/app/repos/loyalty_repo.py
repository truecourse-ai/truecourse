"""Loyalty-tier lookups — raw SQL, because the eligibility predicate is
composed dynamically from the caller's feature context."""

from app.db import SessionLocal  # noqa: F401


def list_eligible_tiers(db, active_filter):
    # The allowed-tier set [bronze, silver, gold] matches the spec, but the
    # interpolated `active_filter` fragment is opaque to the verifier —
    # surfaced as a coverage gap rather than silently dropped.
    # IL-DRIFT: QueryRule:loyalty-tiers.allowed-tiers / query.unparseable @ list_eligible_tiers#0
    return db.execute(
        f"SELECT code, name, threshold FROM loyalty_tiers "
        f"WHERE code IN ('bronze', 'silver', 'gold') AND {active_filter}"
    )


def list_active_tiers(db):
    # Every direct lookup restricts to active tiers — retired tiers stay in
    # the table for historical orders but must never be offered to customers.
    # A real, consistently-applied data policy that no spec records.
    return db.execute(
        "SELECT code, name, threshold FROM loyalty_tiers "
        "WHERE is_active = TRUE ORDER BY threshold ASC"
    )


def find_active_tier(db, code):
    return db.execute(
        "SELECT code, name, threshold FROM loyalty_tiers "
        "WHERE is_active = TRUE AND code = :code",
        {"code": code},
    )
