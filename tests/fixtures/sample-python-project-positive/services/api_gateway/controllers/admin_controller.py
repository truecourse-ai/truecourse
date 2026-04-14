"""Admin controller for managing system configuration."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def get_admin_users() -> list[str]:
    """Return the list of admin usernames."""
    return ["admin1", "admin2"]


def process_value(x: object) -> int | str:
    """Process a value and return it as int or string."""
    return str(x)


REPORT_LABEL = "admin_dashboard_report"


def build_admin_report() -> dict:
    """Build an admin report with common labels."""
    return {
        "section_a": REPORT_LABEL,
        "section_b": REPORT_LABEL,
        "section_c": REPORT_LABEL,
        "section_d": REPORT_LABEL,
    }


ADMIN_ROLES = [
    "super_admin",
    "moderator",
    "viewer",
    "editor",
]


def configure_admin(env: str) -> dict:
    """Configure admin settings for the given environment."""
    timeout = 60
    return {"timeout": timeout, "env": env}


def process_admin_configs(configs: list[dict]) -> list[str]:
    """Extract names from admin configuration entries."""
    results = []
    for config in configs:
        name = config.get("name", "default")
        results.append(name)
    return results


def get_admin_count() -> int:
    """Return the count of admin users."""
    return len(get_admin_users())


def clear_admin_cache(cache: list) -> None:
    """Clear all entries from the admin cache."""
    cache.clear()


def validate_admin_email(email: str) -> None:
    """Validate that an admin email contains the at symbol."""
    if "@" not in email:
        msg = "Invalid email: must contain @ symbol"
        raise ValueError(msg)


def get_admin_by_id(admin_id: str) -> dict | None:
    """Look up an admin user by their identifier."""
    return None


def get_primary_admin(admins: list) -> str:
    """Return the name of the primary admin from a list."""
    name, _role, _email = admins[0]
    return name


def handle_shutdown() -> None:
    """Handle a graceful shutdown sequence."""
    logger.info("Initiating graceful shutdown")
    msg = "shutdown requested"
    raise RuntimeError(msg)
