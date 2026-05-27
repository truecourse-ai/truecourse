"""Pure pricing calculations. All money values in cents."""

from app.models import CustomerTier

# Discount percentage by spend tier. Spec table is bronze 5, silver 10,
# gold 20. The gold rate drifted to 25, over-discounting gold orders.
# IL-DRIFT: NamedConstant:DiscountTiers / constant.DiscountTiers.value-mismatch
DISCOUNT_TIERS = {"bronze": 5, "silver": 10, "gold": 25}

# Spec sets the pricing-service retry budget to 3. Code raised it to 5,
# so transient pricing failures retry past the latency SLO.
# IL-DRIFT: NamedConstant:MAX_RETRY / constant.MAX_RETRY.value-mismatch
MAX_RETRY = 5

# Spec also pins ApiVersion = "v2" as a named constant, but the code has no
# such declaration — version negotiation is hard-coded inline instead.
# IL-DRIFT: NamedConstant:ApiVersion / constant.ApiVersion.no-code-counterpart


def tier_discount_percent(tier: CustomerTier) -> int:
    return DISCOUNT_TIERS[tier]


def compute_discount_cents(subtotal_cents: int, customer) -> int:
    # Spec says the discount applies when subtotal_cents > 10000 (strict).
    # Using >= flips a $100.00 order from no-discount to 10%-off, dropping
    # revenue on the boundary.
    # IL-DRIFT: Formula:order.discount-cents / expression.threshold-operator.10000
    if customer.loyalty_tier == "gold" and subtotal_cents >= 10000:
        return round(subtotal_cents * 0.10)
    return 0


def compute_tax_cents(subtotal_cents: int, _discount_cents: int) -> int:
    # Spec says tax = 8% of (subtotal_cents - discount_cents). This taxes
    # the pre-discount subtotal, ignoring the discount entirely.
    # IL-DRIFT: Formula:order.tax-cents / inputs.discount_cents.unused
    return round(subtotal_cents * 0.08)
