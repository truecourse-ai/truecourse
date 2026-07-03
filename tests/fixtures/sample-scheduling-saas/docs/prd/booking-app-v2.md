# PRD — Booking app (v2)

- **Status:** shipped
- **Owner:** Booking squad
- **Supersedes:** `booking-app-v1.md`

> Supersedes `booking-app-v1.md`. Adds **rescheduling**, lets customers record a
> **cancellation reason**, and **extends the cancellation window from 24 to 48
> hours** after support feedback that a one-day window still left too many
> last-minute no-shows.

## Summary

The booking app is the customer-facing web app for Slate. A signed-in customer
browses providers, sees a provider's open slots, and books, reschedules, or cancels
their **own** appointments. This version keeps v1's booking flow intact and layers
on rescheduling and a longer, self-service cancellation window so customers resolve
changes without contacting support.

## Context & goals

v1 shipped a book-and-cancel flow with a 24-hour cancellation window and no way to
move an appointment — a customer who needed a different time had to cancel and
re-book, which lost the slot to someone else in between. Support asked for two
changes: a real reschedule path, and a wider window so "something came up two days
out" isn't a forfeited slot.

**Goals**

- Let a customer move an appointment to another open slot without losing it.
- Give customers 48 hours (up from 24) to cancel or reschedule themselves.
- Keep booking fast — the create call stays a single request with no new required
  input.

**Non-goals** (see `docs/notes/goals.md`)

- Payments/refunds — those live in the ops console, not here.
- Waitlists for fully-booked providers.

## Users

- **Customer** — an authenticated end user booking for themselves. The only actor
  in this app. Identified by the `customerId` in their JWT subject (ADR 0001).

Staff never use the booking app; agent-driven booking lives in the ops console and
is a separate product (`ops-console.md`).

## Key flows

**Book**
1. Customer opens a provider and calls `GET /api/providers/{id}/slots`.
2. Customer picks an open slot and calls `POST /api/appointments`.
3. Appointment is created `booked`; `appointment.created` (`source: "customer"`) is
   published; the customer sees a confirmation in their local time zone.

**Reschedule**
1. Customer picks a new open slot for the same provider and calls
   `POST /api/appointments/{id}/reschedule`.
2. If more than 48h remain and the reschedule limit isn't hit, `startsAt` moves,
   `rescheduleCount` increments, and `appointment.rescheduled` is published.

**Cancel**
1. Customer calls `POST /api/appointments/{id}/cancel`, optionally with a reason.
2. If more than 48h remain, the appointment becomes `cancelled`,
   `cancellationReason` is stored, and `appointment.cancelled` is published.

## Data model — Appointment

The central record. Base fields come from the README; v2 adds the last three.

| field | type | notes |
|---|---|---|
| `id` | uuid | |
| `providerId` | uuid | the booked provider |
| `customerId` | uuid | owner; taken from the JWT subject, never the request body |
| `startsAt` | timestamp (UTC, ISO-8601) | appointment start; stored UTC (ADR 0003) |
| `status` | enum | `booked` \| `cancelled` \| `completed` \| `no_show` |
| `rescheduleCount` | integer | times the customer has moved it; starts `0`, max `3` |
| `cancellationReason` | string \| null | free text; set only when cancelled |
| `timezone` | string (IANA) \| null | the tz the customer saw at book time; **display only** (ADR 0003) |

### Status lifecycle

`booked` is the only status this app assigns on create. A customer action can move
`booked → cancelled`. `completed` and `no_show` are terminal states set elsewhere
(the ops console / the outbox consumer after `startsAt`), never by the booking app.
Reschedule does not change `status` — it only moves `startsAt`.

## API

Base path `/api`. Every endpoint requires a customer **Bearer JWT** (ADR 0001); a
missing or invalid token is `401`. All timestamps are UTC ISO-8601. Ownership is
enforced on every appointment route: acting on an appointment whose `customerId`
isn't the token subject is `403`. Errors are returned as an HTTP status plus a
machine-readable `error` code (e.g. `too_late`).

### `GET /api/providers`

List bookable providers.

- **Auth:** customer JWT.
- **Response `200`:** `Provider[]` — `{ id, name, timezone }` (the provider's IANA
  tz, per ADR 0003).

### `GET /api/providers/{id}/slots`

Open availability for one provider.

- **Auth:** customer JWT.
- **Query:** `from`, `to` (UTC ISO-8601) — optional window; defaults to the next 14
  days.
- **Response `200`:** `Slot[]` — `{ id, startsAt, durationMinutes }`. Only unbooked
  slots are returned.
- **Errors:** `404 provider_not_found`.

### `POST /api/appointments`

Create an appointment for the authenticated customer.

- **Auth:** customer JWT.
- **Request:** `{ providerId: uuid, slotId: uuid, timezone?: string }` — `timezone`
  is the IANA tz the customer's client displayed, stored for display reconciliation.
- **Response `201`:** the created `Appointment` (`status: "booked"`,
  `rescheduleCount: 0`).
- **Side effect:** publishes `appointment.created` with
  `{ appointmentId, customerId, providerId, source: "customer" }`. This is the
  **customer** flow — distinct from the ops console's agent-sourced
  `appointment.created` (see `ops-console.md`); the two must not be merged.
- **Errors:**

  | status | code | when |
  |---|---|---|
  | `404` | `provider_not_found` | no such provider |
  | `422` | `slot_invalid` | slot doesn't exist or isn't for `providerId` |
  | `409` | `slot_taken` | the slot was booked by someone else first — protects the "never double-book" goal |

### `POST /api/appointments/{id}/reschedule`

Move an appointment to another open slot for the same provider.

- **Auth:** customer JWT; ownership enforced (`403`).
- **Request:** `{ slotId: uuid }` — must be a slot of the appointment's provider.
- **Response `200`:** the updated `Appointment` with the new `startsAt` and an
  incremented `rescheduleCount`.
- **Side effect:** publishes `appointment.rescheduled`.
- **Errors:**

  | status | code | when |
  |---|---|---|
  | `404` | `appointment_not_found` | no such appointment for this customer |
  | `422` | `slot_invalid` | slot missing or belongs to a different provider |
  | `409` | `slot_taken` | target slot already booked |
  | `409` | `too_late` | inside the 48-hour window before `startsAt` |
  | `409` | `reschedule_limit` | already rescheduled 3 times; the 4th attempt is rejected |
  | `409` | `invalid_state` | appointment isn't `booked` |

### `POST /api/appointments/{id}/cancel`

Cancel an appointment.

- **Auth:** customer JWT; ownership enforced (`403`).
- **Request:** `{ reason?: string }` — stored as `cancellationReason`.
- **Response `200`:** the updated `Appointment` (`status: "cancelled"`).
- **Side effect:** publishes `appointment.cancelled`.
- **Errors:**

  | status | code | when |
  |---|---|---|
  | `404` | `appointment_not_found` | no such appointment for this customer |
  | `409` | `too_late` | inside the 48-hour window before `startsAt` |
  | `409` | `invalid_state` | appointment isn't `booked` (already cancelled/completed) |

## Business rules & invariants

- **Ownership.** A customer may read and act only on appointments whose
  `customerId` matches their JWT subject — `403` otherwise. `customerId` is always
  taken from the token, never trusted from the body.
- **48-hour window.** Cancellation and rescheduling are allowed only while **more
  than 48 hours** remain before `startsAt`. At or inside 48h → `409 too_late`.
  (This supersedes v1's 24-hour window; the README's "24 hours" is stale.)
- **Reschedule cap.** A customer may reschedule at most **3** times. The 4th attempt
  → `409 reschedule_limit`.
- **No double-booking.** A slot may back at most one active appointment; a race to
  the same slot resolves to one `201` and one `409 slot_taken`.
- **Single currency of time.** `startsAt` is stored and compared in UTC; `timezone`
  is display metadata only and never affects the window math (ADR 0003).

## Validation

- `providerId`, `slotId` must be uuids; `timezone`, if present, must be a valid IANA
  name (e.g. `America/New_York`), not a fixed offset (ADR 0003). Bad input → `422`.
- The 48-hour and reschedule-cap checks run before any state change, so a rejected
  request publishes no event and leaves the appointment untouched.

## Events

All published via the outbox (ADR 0002):

- `appointment.created` — `{ appointmentId, customerId, providerId, source: "customer" }`
- `appointment.rescheduled` — `{ appointmentId, customerId, newStartsAt }`
- `appointment.cancelled` — `{ appointmentId, customerId, reason }`

## Out of scope

- Listing/reading appointments back is assumed handled by the existing client state
  and is not re-specified here.
- Payments, refunds, and no-show handling — ops console (`ops-console.md`).
- Unlimited reschedules for premium providers — open question in `goals.md`.
