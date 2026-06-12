"""Orders persistence — SQLAlchemy ORM over the Postgres `orders` table."""

from app.db import SessionLocal  # noqa: F401
from app.orm import Order


def get_order(session, order_id):
    return session.query(Order).filter(Order.id == order_id).first()


def list_orders(session, since, until):
    # Spec scopes orders list by tenant (`tenant_id`), anchors the date
    # window on `placed_at`, and INCLUDES soft-deleted rows so the audit
    # view stays complete. This query gets all three wrong: no tenant
    # predicate, the window is anchored on `created_at`, and it filters
    # soft-deleted rows out entirely.
    # IL-DRIFT: QueryRule:orders-list.tenant-scope / query.predicate.missing.tenant_id.eq
    # IL-DRIFT: QueryRule:orders-list.date-anchor / query.date-binding.column-mismatch @ list_orders#0
    # IL-DRIFT: QueryRule:orders-list.no-soft-deleted-included / query.predicate.forbidden-present.deleted_at.is-null @ list_orders#0
    return (
        session.query(Order)
        .filter(Order.created_at >= since)
        .filter(Order.created_at < until)
        .filter(Order.deleted_at.is_(None))
        .order_by(Order.placed_at.desc())
        .all()
    )
