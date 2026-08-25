# Webhooks

Subscribe an HTTPS endpoint to receive appointment events.

- `appointment.created` — fired on every booking, whatever the source.
- `appointment.cancelled` — fired with the cancellation reason.
- `appointment.no_show` — fired when a provider records a no-show.

Deliveries retry with exponential backoff for 24 hours; sign verification uses
the `X-Slate-Signature` HMAC header.
