# Slate — appointment scheduling platform

Slate lets service businesses (salons, clinics, studios) take and manage
appointments. It ships as **two separately-deployed applications** that share a
Postgres database but are built, released, and scaled independently:

- **Booking app** (`apps/booking`) — the customer-facing web app. Visitors browse
  providers, view open slots, and book / reschedule / cancel their own
  appointments. Public, high-traffic, authenticated with short-lived JWTs.
- **Ops console** (`apps/ops`) — the internal staff tool. Support agents manage
  providers, see every appointment across all customers, record no-shows, and
  issue refunds. Behind the corporate SSO; never exposed publicly.

The two apps deliberately overlap on a few domain concepts (an **Appointment**,
the **`appointment.created`** event) but they are NOT the same surface: the
booking app creates appointments when a *customer* books; the ops console creates
them when an *agent* takes a booking over the phone, and its events carry the
agent id. Keep their contracts separate.

## Core domain

An **Appointment** is the central record. At minimum it has:

- `id` — uuid
- `providerId` — the provider being booked
- `customerId` — the customer who booked
- `startsAt` — appointment start (UTC; see ADR 0003)
- `status` — one of `booked`, `cancelled`, `completed`, `no_show`

A **Provider** offers **Availability** (open slots); a **Customer** books against
a slot. Cancellations are allowed up to **24 hours** before `startsAt`; later than
that the slot is forfeit.

## Events

Every state change publishes a domain event via the outbox (ADR 0002):
`appointment.created`, `appointment.cancelled`, `appointment.rescheduled`,
`appointment.completed`. The booking app and ops console each publish
`appointment.created` from their own flows.

See `docs/prd/` for the per-app product specs and `docs/adr/` for the
cross-cutting decisions.
