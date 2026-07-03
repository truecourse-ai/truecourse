# Slate — appointment scheduling platform

Slate lets service businesses (salons, clinics, studios) take and manage
appointments. It ships as **two separately-deployed applications** that share a
Postgres database but are built, released, and scaled independently:

- **Booking app** (`apps/booking`) — the customer-facing web app. Visitors browse
  providers, view open slots, and book / reschedule / cancel their own
  appointments. Public, high-traffic, authenticated with short-lived JWTs (ADR 0001).
- **Ops console** (`apps/ops`) — the internal staff tool. Support agents manage
  providers, see every appointment across all customers, record no-shows, and
  issue refunds. Behind corporate SSO (ADR 0001); never exposed publicly.

The two apps deliberately overlap on a few domain concepts (an **Appointment**,
the **`appointment.created`** event) but they are NOT the same surface: the
booking app creates appointments when a *customer* books; the ops console creates
them when an *agent* takes a booking over the phone, and its events carry the
agent id. Keep their contracts separate.

## Architecture at a glance

- One **Postgres** instance is the system of record for both apps; there is no
  sync layer between them (ADR 0002).
- Domain events are delivered with a **transactional outbox** — a relay publishes
  committed event rows to the message bus (ADR 0002).
- All appointment times are stored in **UTC** and rendered in the relevant **IANA**
  time zone (ADR 0003).
- Auth differs per app: customer **Bearer JWT** for the booking app, **Okta SSO**
  with the `ops-agent` role for the ops console (ADR 0001).

## Core domain

An **Appointment** is the central record, shared by both apps. At minimum it has:

| field | type | notes |
|---|---|---|
| `id` | uuid | |
| `providerId` | uuid | the provider being booked |
| `customerId` | uuid | the customer who booked |
| `startsAt` | timestamp (UTC) | appointment start (ADR 0003) |
| `status` | enum | `booked` \| `cancelled` \| `completed` \| `no_show` |

The booking app extends the Appointment with a few more fields (see
`docs/prd/booking-app-v2.md`); the ops console reuses the same record rather than
defining its own.

Supporting records:

- **Provider** — offers appointments; carries a display name and an IANA `timezone`
  (ADR 0003).
- **Availability / Slot** — a provider's open time slot (`startsAt`, duration) that a
  customer books against. A slot backs at most one active appointment (no
  double-booking).
- **Customer** — the end user who books.

Cancellations are allowed up to **24 hours** before `startsAt`; later than that the
slot is forfeit.

## Events

Every state change publishes a domain event via the outbox (ADR 0002):
`appointment.created`, `appointment.cancelled`, `appointment.rescheduled`,
`appointment.completed`. The booking app and ops console each publish
`appointment.created` from their own flows — the customer-initiated one and the
agent-initiated one — as **separate contracts**.

See `docs/prd/` for the per-app product specs and `docs/adr/` for the
cross-cutting decisions.
