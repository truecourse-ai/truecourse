/**
 * Sample webhook payloads used to seed integration tests.
 * Values prefixed `SAMPLE_` are placeholders, not real credentials.
 *
 * Below is a sample event payload (in a comment) showing the expected shape:
 * {"message": "slack_on_event", "payload": {"token": "xoxb-SAMPLE-TOKEN-VALUE", "team_id": "T01"}}
 */

export const sampleSigningPayload = {
  event: 'document.signed',
  token: 'SIGNING_TOKEN',
  data: { documentId: 'doc_1' },
};

export const sampleWebhookPayload = {
  event: 'webhook.received',
  token: 'SAMPLE_WEBHOOK_TOKEN',
  data: { source: 'github' },
};
