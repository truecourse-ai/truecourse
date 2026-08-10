# PRD — Partner booking API

> Let aggregators (ClassPass-style marketplaces, hotel concierge tools) create
> and cancel appointments for their own users through the booking app's API.

## Why

Two mid-size aggregators asked for direct integration in Q4; both estimate
300+ bookings/week. Manual onboarding through the widget loses them at the
volume they need.

## Surface

Partners call the existing booking endpoints (`/api/appointments`,
`/api/appointments/{id}/cancel`) — no separate partner surface. A partner
booking carries `source: "partner"` and the `partnerId` in the
`appointment.created` event payload.

## Authentication

Partners authenticate every `/api/*` call with a **static API key** issued at
onboarding and passed in the `X-Partner-Key` header. Keys do not expire; a
partner rotates its key from the partner dashboard when compromised. There is
no JWT flow for partners — server-to-server callers cannot run a refresh-cookie
exchange.

## Rules

- A partner may only act on appointments it created (matched on `partnerId`).
- Partner cancellations follow the same cancellation window as customers.
- Rate limit: 10 requests/second per key, `429` beyond it.
