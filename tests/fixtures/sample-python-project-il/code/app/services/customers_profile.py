"""Public customer-profile read path.

The public profile is the customer-facing view of an account: it deliberately
projects only the fields a customer is allowed to see and serializes them back
over the API. Two cross-cutting decisions live here as code:

  - The read PROJECTION (`.values(...)`) is the authoritative column set the
    profile query asks the data store for. `loyalty_tier` is part of that set,
    so the tier always travels on the read path -- it is never silently dropped
    from the projection.
  - The API RESPONSE shape echoes the projected columns back to the caller, so
    `loyalty_tier` reaches the consumer rather than being read-then-discarded.

`internal_notes` is a staff-only field; it is never part of the public profile,
so it appears in neither the projection nor the response.
"""

from app.orm import Customer


def read_public_profile(customer_id):
    """Load the public profile for a customer.

    The `.values(...)` projection is the exposed column set -- the staff-only
    `internal_notes` field is deliberately left out of it.
    """
    return (
        Customer.objects.filter(id=customer_id)
        .values("id", "email", "loyalty_tier")
        .first()
    )


def render_public_profile(profile):
    """Serialize a loaded profile back to the API caller.

    The response shape echoes the projected columns -- `loyalty_tier` is
    exposed on this read path too.
    """
    return {
        "id": profile["id"],
        "email": profile["email"],
        "loyalty_tier": profile["loyalty_tier"],
    }
