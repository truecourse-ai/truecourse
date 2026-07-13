# PRD — Ops console

- **Status:** shipped
- **Owner:** Support Operations
- **Deployment:** separate service from the booking app, behind corporate SSO;
  never exposed publicly.

## Summary

The ops console is the internal tool support agents use to run the scheduling
business across **all** customers and providers. Agents triage and search every
appointment, take bookings over the phone on a customer's behalf, mark no-shows,
and issue refunds. It shares the Appointment domain with the booking app but is a
**separate product** with its own surface, its own auth, and its own event
variants — its contracts must stay distinct from the booking app's.

## Context & goals

Customers self-serve in the booking app, but support still needs a back office: a
customer calls to book, an appointment needs to be marked as a no-show after the
fact, or a cancelled appointment needs money returned. None of that belongs on the
public API, and agents act on appointments that aren't "theirs," so it needs a
different identity model and no ownership checks.

**Goals**

- One place for an agent to find and act on **any** appointment.
- Let agents book on a customer's behalf (phone bookings), clearly attributed to
  the agent.
- Support the post-appointment operations customers can't do themselves: no-show
  and refund.

**Non-goals** (see `docs/notes/goals.md`)

- Customer-facing anything — that's the booking app.
- Capturing/settling payments. Money movement goes through the external PSP; the
  console only records the intent to refund.

## Users & access

- **Support agent** — an employee in Okta with the `ops-agent` role. The only actor.
  Identified by `agentId` from the SSO session. Agents have no "own" appointments;
  they act across the whole platform.

## Key flows

**Triage / search**
1. Agent calls `GET /ops/appointments` with filters (provider, customer, status,
   date range) to find the appointment in question.

**Phone booking**
1. A customer calls in; the agent finds an open slot and calls
   `POST /ops/appointments` with the customer's id.
2. The appointment is created `booked`; `appointment.created` is published with
   `source: "agent"` and the acting `agentId`.

**Mark no-show**
1. After a missed appointment, the agent calls `POST /ops/appointments/{id}/no-show`;
   the appointment moves `booked → no_show`.

**Refund**
1. For a `cancelled` or `no_show` appointment, the agent calls
   `POST /ops/appointments/{id}/refund` with an amount and reason; a Refund record
   is created and handed to the PSP.

## Data model

### Appointment (shared)

The ops console reads and writes the **same** `Appointment` entity the booking app
owns (fields in the README / `booking-app-v2.md`) — it does not define its own
variant. It is the only surface that assigns `no_show`, and it sets it via the
no-show endpoint (`booked → no_show`).

### Refund (owned by this product)

| field | type | notes |
|---|---|---|
| `id` | uuid | |
| `appointmentId` | uuid | the refunded appointment |
| `amountCents` | integer | minor units; the amount to return via the PSP |
| `reason` | string | free text, required |
| `status` | enum | `pending` \| `settled` \| `failed` — driven by the PSP callback |
| `agentId` | uuid | the agent who issued it |
| `createdAt` | timestamp (UTC, ISO-8601) | |

## API

Base path `/ops`. Every endpoint requires an **Okta SSO session** with the
`ops-agent` role (ADR 0001); there is **no Bearer-JWT path** here. A missing/invalid
session is `401`; a valid session without `ops-agent` is `403`. Unlike the booking
app there is **no ownership check** — an agent may act on any appointment. All
timestamps are UTC ISO-8601; errors are an HTTP status plus a machine `error` code.

### `GET /ops/appointments`

List/search every appointment across the platform.

- **Auth:** Okta SSO, `ops-agent`.
- **Query:** `providerId?`, `customerId?`, `status?`, `from?`, `to?` (UTC ISO-8601
  date range), `cursor?`, `limit?` (default 50, max 200).
- **Response `200`:** `{ items: Appointment[], nextCursor: string | null }` —
  cursor-paginated; a null `nextCursor` means the last page.

### `POST /ops/appointments`

An agent books on a customer's behalf (phone booking).

- **Auth:** Okta SSO, `ops-agent`.
- **Request:** `{ providerId: uuid, customerId: uuid, slotId: uuid }` — note
  `customerId` is supplied by the agent, not derived from a token.
- **Response `201`:** the created `Appointment` (`status: "booked"`).
- **Side effect:** publishes `appointment.created` with
  `{ appointmentId, customerId, providerId, source: "agent", agentId }`. This is the
  **agent** flow — a distinct contract from the booking app's customer-initiated
  `appointment.created` (`source: "customer"`, no `agentId`). The two must never be
  merged into one artifact.
- **Errors:**

  | status | code | when |
  |---|---|---|
  | `404` | `provider_not_found` | no such provider |
  | `404` | `customer_not_found` | no such customer |
  | `422` | `slot_invalid` | slot missing or not for `providerId` |
  | `409` | `slot_taken` | slot already booked |

### `POST /ops/appointments/{id}/no-show`

Mark an appointment as a no-show.

- **Auth:** Okta SSO, `ops-agent`.
- **Response `200`:** the updated `Appointment` (`status: "no_show"`).
- **Errors:**

  | status | code | when |
  |---|---|---|
  | `404` | `appointment_not_found` | no such appointment |
  | `409` | `invalid_state` | appointment isn't `booked`, or `startsAt` is still in the future |

### `POST /ops/appointments/{id}/refund`

Issue a refund against a cancelled or no-show appointment.

- **Auth:** Okta SSO, `ops-agent`.
- **Request:** `{ amountCents: integer, reason: string }`.
- **Response `201`:** the created `Refund` (`status: "pending"`).
- **Errors:**

  | status | code | when |
  |---|---|---|
  | `404` | `appointment_not_found` | no such appointment |
  | `409` | `invalid_state` | appointment is not `cancelled` or `no_show` |
  | `422` | `amount_invalid` | `amountCents` ≤ 0, or `reason` missing |

## Business rules & invariants

- **Role gate, no ownership.** Every endpoint requires the `ops-agent` role, but
  there is no per-appointment ownership check — acting across all customers is the
  whole point of the console.
- **Agent attribution.** Every write records the acting `agentId` (on the
  `appointment.created` event, on the Refund record). `customerId` on a phone
  booking comes from the request, since the agent is not the customer.
- **Refund eligibility.** A refund is allowed only when the appointment is
  `cancelled` or `no_show` — otherwise `409 invalid_state`. The console records the
  refund intent; the PSP settles it and drives the Refund `status`.
- **Distinct agent event.** The `appointment.created` published here carries
  `source: "agent"` and `agentId`; it is a separate contract from the booking app's
  `source: "customer"` event — keep the two products' contracts apart.

## Validation

- `providerId`, `customerId`, `slotId` must be uuids; `amountCents` a positive
  integer in minor units; `reason` non-empty. Bad input → `422`.
- State preconditions (no-show requires `booked` + past `startsAt`; refund requires
  `cancelled`/`no_show`) are checked before any write, so a rejected request creates
  no Refund and publishes no event.

## Events

Published via the outbox (ADR 0002):

- `appointment.created` — **agent** variant:
  `{ appointmentId, customerId, providerId, source: "agent", agentId }`.

The `no_show` transition and the Refund lifecycle are internal state changes; no
distinct domain event is published for them today (see the open note below).

## Out of scope

- Customer self-service (booking/reschedule/cancel) — booking app.
- Actually moving money — the external PSP settles refunds; the console only records
  intent and reflects the PSP's `status` callback.
- Clawing back an already-settled refund.

> **Open question:** the shared event list (ADR 0002) enumerates
> `appointment.created/.cancelled/.rescheduled/.completed` but has no `no_show`
> event, even though `no_show` is a real status. Downstream consumers that key off
> the outbox can't currently react to a no-show. Do we add `appointment.no_show`?
