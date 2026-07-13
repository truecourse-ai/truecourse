# ADR 0002 — Data store and event delivery

- **Status:** accepted (2024-01-22)
- **Deciders:** Platform

## Context

The booking app and the ops console must agree on appointment state — both read and
write the same appointments — and several downstream reactions hang off state
changes (a confirmation email on `appointment.created`, reminders, analytics). A
dropped `appointment.created` means a customer never gets a confirmation; a
duplicated one means two emails. We want reliable event delivery tied to the state
change, without a two-phase commit across the database and the message bus.

## Decision

We use **Postgres** as the single system of record for both apps. Domain events
(`appointment.created`, `.cancelled`, `.rescheduled`, `.completed`) are delivered
with a **transactional outbox**: the state change and the event row commit in the
same transaction, and a relay publishes the outbox to the message bus.

## Alternatives considered

- **A database per app.** Rejected: the two apps share the appointment lifecycle, so
  separate stores force a synchronization layer and a source-of-truth question we'd
  rather not have.
- **Dual-write: write the DB, then publish to the bus directly.** Rejected: the
  classic partial-failure hole — the row commits but the publish fails (or vice
  versa), and state and events silently diverge.
- **Change data capture (Debezium / logical replication).** Rejected for now:
  reliable, but a heavier operational footprint than a small outbox relay warrants at
  our current scale. Revisitable if the outbox becomes a bottleneck.
- **Two-phase / XA commit across Postgres and the broker.** Rejected: operationally
  brittle and poorly supported by our broker.

## Consequences

- **(+)** Events can never be lost relative to the state change that produced them;
  no distributed transaction is required.
- **(+)** One Postgres instance keeps the two apps consistent with no sync layer
  between them.
- **(−)** We run and monitor a relay process; if it stalls, events lag (state is
  still correct, delivery is delayed).
- **(−)** Delivery is **at-least-once**, so every consumer must be idempotent and
  dedupe on event id — this pairs with the idempotent transitions consumers rely on.
- **(−)** The outbox table grows and needs pruning after publish; event ordering is
  only guaranteed per appointment, not globally.
- **(−)** A single shared Postgres is a coupling point and an eventual scaling
  ceiling for both apps at once.
