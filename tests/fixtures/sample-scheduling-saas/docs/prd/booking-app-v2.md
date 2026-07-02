# PRD — Booking app (v2)

Status: shipped

> Supersedes `booking-app-v1.md`. Adds rescheduling and **extends the
> cancellation window to 48 hours** after support feedback about no-shows.

## Product: booking-app

The customer-facing web app for browsing providers and booking, rescheduling,
and cancelling appointments.

## Endpoints

- `GET /api/providers` — list bookable providers.
- `GET /api/providers/{id}/slots` — open availability for a provider.
- `POST /api/appointments` — create an appointment for the authenticated customer.
  Body: `{ providerId, slotId }`. Responds `201` with the Appointment. Publishes
  `appointment.created` with `{ appointmentId, customerId, providerId, source: "customer" }`.
- `POST /api/appointments/{id}/cancel` — cancel an appointment; sets `cancellationReason`.
  Publishes `appointment.cancelled`.
- `POST /api/appointments/{id}/reschedule` — move an appointment to a new slot.
  Body: `{ slotId }`. Increments `rescheduleCount`. Publishes `appointment.rescheduled`.

## Appointment (extensions)

In addition to the base fields in the README, the booking app records:

- `rescheduleCount` — number of times the customer has moved this appointment (max 3).
- `cancellationReason` — free text, set when cancelled.
- `timezone` — IANA tz the customer saw the time in (display only; storage is UTC).

## Rules

- Auth: every endpoint requires a customer Bearer JWT (ADR 0001). A customer may
  act only on their **own** appointments — `403` otherwise.
- **Cancellation and rescheduling are allowed up to 48 hours before `startsAt`.**
  Inside 48h → `409 too_late`.
- A customer may reschedule at most **3** times; the 4th attempt → `409`.
