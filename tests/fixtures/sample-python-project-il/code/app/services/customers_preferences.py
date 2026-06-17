"""Customer preference + loyalty-downgrade rules.

This service is where three cross-cutting decisions live in code:

  1. A conditional field-requiredness guard (validation-rule): a downgrade
     reason is only required when a `gold` customer downgrades themselves.
  2. A runtime null/absent -> default coalescing (fallback): a customer with
     no recorded tier is billed as `standard`.
  3. A storage-strategy split (persistence-strategy): `loyalty_tier` is a
     first-class column, but `marketing_opt_in` / `beta_features` are kept as
     keys inside the customer's `metadata` JSON blob.
"""

DEFAULT_LOYALTY_TIER = "standard"


class PreferenceValidationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def read_preferences(customer):
    """Project a stored customer row into the flat preferences the API exposes.

    `loyalty_tier` is a dedicated column read straight off the row;
    `marketing_opt_in` and `beta_features` are NOT columns -- they live as
    keys inside the `metadata` JSON blob, so they are read through it.
    """
    # Runtime fallback: a customer with no recorded tier is treated as standard.
    loyalty_tier = customer.loyalty_tier or DEFAULT_LOYALTY_TIER
    metadata = customer.metadata or {}
    return {
        "loyalty_tier": loyalty_tier,
        # Metadata-JSON keys -- read off the blob, never their own column.
        "marketing_opt_in": bool(metadata.get("marketing_opt_in")),
        "beta_features": bool(metadata.get("beta_features")),
    }


def validate_downgrade(customer, actor, downgrade_reason):
    """Guard a self-service loyalty downgrade. A gold customer downgrading
    their own tier must record why -- the reason feeds win-back outreach.
    Staff-side downgrades (actor `admin`) and non-gold customers are exempt.
    """
    if customer.loyalty_tier == "gold" and actor == "customer" and not downgrade_reason:
        raise PreferenceValidationError(
            "downgrade_reason_required",
            "A reason is required when a gold customer downgrades their own tier.",
        )
