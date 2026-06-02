# ADR-003: Inter-service messaging

## Status

Accepted

## Decision

Adopt **Kafka** for inter-service messaging — order-lifecycle events must
be strictly ordered and replayable for the audit pipeline.

## Rejected alternatives

- **RabbitMQ** — no replay without plugins.
- **SQS** — at-least-once delivery but no strict ordering per key.
