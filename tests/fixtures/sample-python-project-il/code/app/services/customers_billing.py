"""Customer billing-summary read path.

The billing summary is the account-billing view a customer sees: it projects
the billing-relevant columns and returns them to the caller. The contract
`customer.store-credit-exposed` says the customer's `store_credit` balance must
travel on this read path -- it must be part of the read projection so the
balance reaches the consumer.

This implementation's projection selects `balance_cents` but OMITS
`store_credit`, so the store-credit balance is never selected and never reaches
the consumer -- the exposure the contract promises is dropped.
"""

from app.orm import Customer


def read_billing_summary(customer_id):
    """Load the billing summary for a customer.

    The `.values(...)` projection is the exposed column set -- `store_credit`
    is not part of it.
    """
    # IL-DRIFT: FieldExposure:customer.store-credit-exposed / field-exposure.customer.store-credit-exposed.not-exposed
    return (
        Customer.objects.filter(id=customer_id)
        .values("balance_cents")
        .first()
    )
