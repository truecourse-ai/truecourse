"""Identity-investigation attribute taxonomy.

In this domain, the literal `"password"` is a *type* of evidence (a
field-name identifier) — not a credential. It appears as a StrEnum
member, as a dict key in field-name maps, and as a UI label. The
hardcoded-secret rule should not flag any of these.
"""
from enum import StrEnum


class AttributeType(StrEnum):
    """Categorical attribute types for an identity record."""

    EMAIL = "email"
    PHONE = "phone"
    PASSWORD = "password"
    USERNAME = "username"
    SSN = "ssn"


# Field-name → metadata-property map. The string `"password"` here is a
# dict key referring to the *field name*, not a credential value.
IDLINK_METADATA_PROPS: dict[str, str] = {
    "password": "hashed_password",
    "email": "primary_email",
    "phone": "primary_phone",
}


def display_label(attribute: AttributeType) -> str:
    """Map enum members to human-readable display labels."""
    labels: dict[AttributeType, str] = {
        AttributeType.EMAIL: "Email",
        AttributeType.PHONE: "Phone",
        AttributeType.PASSWORD: "Password",
        AttributeType.USERNAME: "Username",
        AttributeType.SSN: "SSN",
    }
    return labels[attribute]
