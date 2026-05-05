"""Sample webhook payloads used to seed integration tests.

Values starting with ``SAMPLE_`` are placeholders, not real credentials.

Below is a sample event payload (in a comment) showing the expected shape:
    # {"message": "slack_on_event", "payload": {"token": "xoxb-SAMPLE-TOKEN-VALUE"}}
"""

SAMPLE_SIGNING_PAYLOAD = {
    'event': 'document.signed',
    'token': 'SIGNING_TOKEN',
    'data': {'document_id': 'doc_1'},
}

SAMPLE_WEBHOOK_PAYLOAD = {
    'event': 'webhook.received',
    'token': 'SAMPLE_WEBHOOK_TOKEN',
    'data': {'source': 'github'},
}
