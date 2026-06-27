# PRD — Ops console

Status: shipped

The internal staff tool for managing the scheduling platform. Separate
deployment from the booking app, behind corporate SSO.

## Product: ops-console

Support agents use this to operate the business across ALL customers and
providers — not their own appointments (agents have no "own" appointments).

## Endpoints

- `GET /ops/appointments` — list/search every appointment (filter by provider,
  customer, status, date range). Cursor-paginated.
- `POST /ops/appointments` — an agent creates an appointment on a customer's
  behalf (phone booking). Body: `{ providerId, customerId, slotId }`. Publishes
  `appointment.created` with `{ appointmentId, customerId, providerId, source: "agent", agentId }`.
- `POST /ops/appointments/{id}/no-show` — mark an appointment `no_show`.
- `POST /ops/appointments/{id}/refund` — issue a refund for a cancelled/no-show
  appointment. Body: `{ amountCents, reason }`.

## Rules

- Auth: every endpoint requires an Okta SSO session with the `ops-agent` role
  (see ADR 0001). There is no Bearer-JWT path here.
- Agents may act on **any** appointment (no ownership restriction) — that is the
  whole point of the console.
- Refunds are only allowed on appointments in `cancelled` or `no_show` status →
  otherwise `409`.
- `appointment.created` published here is the **agent** flow: it carries `agentId`
  and `source: "agent"`. This is a distinct contract from the booking app's
  customer-initiated `appointment.created`.
