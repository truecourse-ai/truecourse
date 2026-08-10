# Research — SMS reminder providers

_Evaluation of third-party SMS vendors for appointment reminders. This is about
THEIR products, not ours — no decision recorded yet._

We want to text customers a reminder 24h before an appointment. Candidates:

## Twilio
- Programmable Messaging API; `POST /2010-04-01/Accounts/{Sid}/Messages.json`.
- Delivery webhooks; ~$0.0079 / segment in the US.
- Mature, but pricier; their `MessagingServiceSid` pooling is nice.

## MessageBird
- Single `POST /messages` endpoint; pay-as-you-go.
- Cheaper in EU; smaller US coverage.

## Open questions
- Do we need delivery receipts, or is fire-and-forget fine?
- Quiet-hours handling per the customer's tz (see our ADR 0003)?

No decision yet — revisit next quarter.
