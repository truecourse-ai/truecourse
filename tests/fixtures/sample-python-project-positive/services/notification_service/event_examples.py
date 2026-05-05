"""Sample event payloads kept as documentation comments.

The `#` line below is a sample Slack `slack_on_event` payload showing the
JSON shape — every value (token, team_id, user_id, channel, event_context
base64) is fake. The hardcoded-secret-in-comment rule must skip JSON-
shaped sample payloads in comments, since high-entropy substrings inside
them are documentation, not real credentials.

Mirrors OpenHands' enterprise/server/routes/integration/slack.py:300.
"""

# {"message": "slack_on_event", "severity": "INFO", "payload": {"token": "i8Al1OkFR99MafAxURXhRJ7b", "team_id": "T07E1S2M2Q6", "api_app_id": "A08MFF9S6FQ", "event": {"user": "U07G13E21DK", "type": "app_mention"}, "event_context": "4-eyJldCI6ImFwcF9tZW50aW9uIiwidGlkIjoiVDA3RTFTMk0yUTYiLCJhaWQiOiJBMDhNRkY5UzZGUSIsImNpZCI6IkMwOE1ZUTFQUVMwIn0"}}


def handle_event(payload: dict) -> str:
    """Return the event type from the payload, or 'unknown'."""
    return payload.get('type', 'unknown')
