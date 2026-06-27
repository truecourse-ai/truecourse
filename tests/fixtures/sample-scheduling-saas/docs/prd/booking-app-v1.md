# PRD — Booking app (v1)

Status: superseded by booking-app-v2

> This is the original booking-app spec. It shipped the first booking flow.
> **Superseded by `booking-app-v2.md`**, which adds rescheduling and changes the
> cancellation window. Kept for history.

## Product: booking-app

The customer-facing web app for browsing providers and booking appointments.

## Endpoints

- `GET /api/providers` — list bookable providers.
- `GET /api/providers/{id}/slots` — open availability for a provider.
- `POST /api/appointments` — create an appointment for the authenticated customer.
  Body: `{ providerId, slotId }`. Responds `201` with the Appointment.
- `POST /api/appointments/{id}/cancel` — cancel an appointment.

## Rules

- Auth: every endpoint requires a customer Bearer JWT (see ADR 0001).
- A customer may only cancel their **own** appointments.
- **Cancellation is allowed up to 24 hours before `startsAt`.** Later → `409`.
- On a successful booking, publish `appointment.created`.

## Out of scope (v1)

- Rescheduling — a cancel + re-book is the only path in v1.
