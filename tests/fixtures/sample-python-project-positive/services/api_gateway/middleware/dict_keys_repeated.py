"""Repeated dict-key access strings.

API payload handlers commonly read the same field name several
times via subscript or `.get(...)`. The string IS the schema
field name — extracting it to a constant adds indirection with
no benefit. duplicate-string was incorrectly flagging these.

Positive fixture: NO duplicate-string violations should fire on
this file.
"""

from __future__ import annotations



def parse_payload(message: dict[str, object]) -> dict[str, object]:
    """Read the same canonical field names multiple times."""
    payload = message.get("payload") or {}
    if "payload" in message and isinstance(payload, dict):
        actor = payload.get("actor") or {}
        slug = actor.get("slug") or ""
        name = actor.get("name") or ""
        actor_id = str(actor.get("id") or "")
        return {
            "slug": slug,
            "name": name,
            "id": actor_id,
            "payload": payload,
        }
    return {"slug": "", "name": "", "id": "", "payload": {}}


def normalize_status(record: dict[str, object]) -> str:
    """Read 'status' from several alternative shapes."""
    status = record.get("status")
    if status is None:
        status = record.get("state") or record.get("status")
    if not status:
        return "unknown"
    return str(status)
