"""API routes for the application."""
import logging

logger = logging.getLogger(__name__)


def list_items() -> dict:
    """Return a list of all items."""
    return {"items": []}


def get_item(item_id: int) -> dict:
    """Retrieve a single item by ID."""
    return {"id": item_id}
