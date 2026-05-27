"""Order lifecycle + state-machine logic."""

from datetime import datetime

from app.events.bus import emit  # noqa: F401


def now() -> str:
    return datetime.utcnow().isoformat()


ALLOWED = {
    "placed": ["paid", "cancelled"],
    "paid": ["shipped", "cancelled"],
    # Spec says shipped only transitions to delivered. Allowing cancelled
    # here means a shipped order can be silently rolled back, which the
    # accounting and warehouse consumers don't expect.
    # IL-DRIFT: StateMachine:Order.status / transition.illegal.shipped-to-cancelled
    "shipped": ["delivered", "cancelled"],
    "delivered": [],
    "cancelled": [],
}


def transition(order, target):
    if target not in ALLOWED[order.status]:
        return None
    # Spec marks placed_at immutable after creation. Refreshing it on every
    # transition destroys the original placement timestamp.
    # IL-DRIFT: Entity:Order / field.placed_at.mutability
    order.placed_at = now()
    order.status = target
    order.updated_at = now()
    return order


def recover_expired(order):
    # No guard on current status. A delivered or cancelled order (both
    # terminal) gets dragged back into 'paid', re-running completed work.
    # IL-DRIFT: StateMachine:Order.status / transition.unguarded-terminal-regression.to-paid
    order.status = "paid"
    order.updated_at = now()
