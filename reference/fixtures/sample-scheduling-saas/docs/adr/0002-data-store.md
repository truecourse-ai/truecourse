# ADR 0002 — Data store and event delivery

Status: accepted

## Decision

We use **Postgres** as the single system of record for both apps. Domain events
(`appointment.created`, `.cancelled`, `.rescheduled`, `.completed`) are delivered
with a **transactional outbox**: the state change and the event row commit in the
same transaction, and a relay publishes the outbox to the message bus.

## Context

Both apps must agree on appointment state, and a dropped `appointment.created`
would mean a missed confirmation email. The outbox gives us exactly-once-ish
delivery without a distributed transaction across Postgres and the bus.
