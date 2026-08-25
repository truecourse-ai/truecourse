# ADR 0004 — Refund window and eligibility

**Status:** Accepted (2025-11-02)

## Context

Support keeps escalating refund requests weeks after the appointment. Finance
wants a hard boundary they can reconcile against; the ops console currently
enforces nothing beyond appointment status.

## Decision

A refund may be issued only within **14 days** of the appointment's scheduled
start, and only for appointments in `cancelled` status. `no_show` appointments
are **not refundable** — the slot was held and the provider was present; support
compensates no-shows with a credit voucher instead, through the separate
voucher tool.

`POST /ops/appointments/{id}/refund` must reject an out-of-window or `no_show`
refund with `422 refund_not_allowed`.

## Consequences

- Finance reconciles refunds against a bounded 14-day tail.
- The voucher tool becomes the only compensation path for no-shows.
- The ops console UI hides the refund action outside the window instead of
  letting the request fail.
