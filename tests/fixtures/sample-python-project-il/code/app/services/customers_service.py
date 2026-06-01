"""Customer creation."""

from datetime import datetime
from uuid import uuid4

from app.orm import Customer


def create_customer(email: str, name: str):
    # Spec says email is lowercased on write. Storing raw input means two
    # customers with `Foo@Example.com` and `foo@example.com` are not deduped
    # and lowercase-email lookups miss the row.
    # IL-DRIFT: Entity:Customer / field.email.normalize
    customer = Customer(
        id=str(uuid4()),
        email=email,
        name=name,
        loyalty_tier="standard",
        status="active",
        created_at=datetime.utcnow().isoformat(),
    )
    return customer
