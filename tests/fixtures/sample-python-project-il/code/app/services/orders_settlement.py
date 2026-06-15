"""Order settlement helpers.

Settlement is the point where an order's totals are committed to a payment
processor in a specific currency. The contract `order.currency-default` says an
order with no recorded settlement currency falls back to the named constant
`DEFAULT_CURRENCY` (USD) at read time.

This implementation reads `order.currency` straight off the row with no
coalescing, so an order whose currency is null/absent settles with a missing
currency rather than the documented USD default -- the fallback is never
applied.
"""

DEFAULT_CURRENCY = "USD"


def resolve_settlement_currency(order):
    """Resolve the currency an order settles in.

    The stored `currency` is read through directly -- no fallback to the
    default when it is null/absent.
    """
    # IL-DRIFT: Fallback:order.currency-default / fallback.order.currency-default.not-applied
    currency = order.currency
    return {
        "order_id": order.id,
        "amount_cents": order.total_cents,
        "currency": currency,
    }
