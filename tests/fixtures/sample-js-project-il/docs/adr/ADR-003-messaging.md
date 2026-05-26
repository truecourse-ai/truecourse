# ADR-003: Inter-service messaging

## Status

Accepted

## Context

Order-lifecycle events must be strictly ordered and replayable for the
downstream audit pipeline.

## Decision

Adopt **Kafka** for inter-service messaging.

## Rejected alternatives

- **RabbitMQ** — no replay without plugins.
- **SQS** — at-least-once delivery but no strict ordering per key.
