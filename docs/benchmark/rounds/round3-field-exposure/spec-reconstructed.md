# Specification: Cancellation Reason Requirement for Event Types

## Overview

This feature lets an **Event Type** declare whether a **cancellation reason** must be
provided when a booking of that event type is cancelled. The requirement can be
configured independently for the two parties involved in a booking — the **host** and the
**attendee** — so that a reason can be mandatory for both, for one party only, or for
neither.

The configuration lives on the event type as a single setting,
`requiresCancellationReason`, whose value is drawn from a fixed set of policy options. At
cancellation time, this setting drives validation of the booking's `cancellationReason`
field depending on who is cancelling.

Sources are attributed to `docs/design.md` (technical design) and `docs/decisions.md`
(architecture decision record).

---

## Data Model

### Enum: `CancellationReasonRequirement`

*(Origin: docs/design.md — "Technical Design / Database Changes", lines 21–27)*

The set of cancellation-reason policies an event type can adopt:

| Value | Meaning |
|---|---|
| `MANDATORY_BOTH` | A cancellation reason is required from both the host and the attendee. |
| `MANDATORY_HOST_ONLY` | A cancellation reason is required only when the host cancels. |
| `MANDATORY_ATTENDEE_ONLY` | A cancellation reason is required only when the attendee cancels. |
| `OPTIONAL_BOTH` | A cancellation reason is optional for both parties. |

### Entity: `EventType`

*(Origin: docs/design.md — "Technical Design / Database Changes", lines 19–29)*

The `EventType` entity carries the cancellation-reason policy:

| Field | Type | Default |
|---|---|---|
| `requiresCancellationReason` | `CancellationReasonRequirement` (enum) | `MANDATORY_HOST_ONLY` |

- **`requiresCancellationReason`** — Stores the event type's cancellation-reason policy.
  Its declared default value is **`MANDATORY_HOST_ONLY`**: a newly created event type
  requires a cancellation reason from the host but not from the attendee unless configured
  otherwise.

---

## Behavior

The booking's `cancellationReason` field is conditionally required at cancellation time,
based on the event type's `requiresCancellationReason` setting and on who is performing
the cancellation (the actor).

### Rule: `booking.cancellation-reason-required-host`

*(Origin: docs/design.md — "Technical Design / API Changes", lines 31–36)*

- **Target field:** `cancellationReason` (on the booking).
- **Actor:** host.
- **Condition:** the event type's `requiresCancellationReason` is one of
  `MANDATORY_BOTH` or `MANDATORY_HOST_ONLY`.
- **Effect:** `cancellationReason` is **required**.

When a **host** cancels a booking whose event type requires a reason from the host (either
`MANDATORY_BOTH` or `MANDATORY_HOST_ONLY`), a cancellation reason must be supplied.

### Rule: `booking.cancellation-reason-required-attendee`

*(Origin: docs/design.md — "Technical Design / API Changes", lines 31–36)*

- **Target field:** `cancellationReason` (on the booking).
- **Actor:** attendee.
- **Condition:** the event type's `requiresCancellationReason` is one of
  `MANDATORY_BOTH` or `MANDATORY_ATTENDEE_ONLY`.
- **Effect:** `cancellationReason` is **required**.

When an **attendee** cancels a booking whose event type requires a reason from the
attendee (either `MANDATORY_BOTH` or `MANDATORY_ATTENDEE_ONLY`), a cancellation reason
must be supplied.

### Derived behavior

Taken together, the two validation rules and the enum imply:

- `MANDATORY_BOTH` → reason required regardless of who cancels (host or attendee).
- `MANDATORY_HOST_ONLY` → reason required only when the host cancels.
- `MANDATORY_ATTENDEE_ONLY` → reason required only when the attendee cancels.
- `OPTIONAL_BOTH` → reason never required by either rule (no rule matches this value).

---

## Edge Cases / Fallback

### Fallback: `eventType.requires-cancellation-reason-default`

*(Origin: docs/design.md — "Edge Cases", lines 68–73)*

- **Target:** `EventType.requiresCancellationReason`.
- **Trigger:** the value is **null or absent**.
- **Default applied:** `MANDATORY_HOST_ONLY`.

If an event type has no value (null or missing) for `requiresCancellationReason`, the
system treats it as `MANDATORY_HOST_ONLY`. This guarantees the validation logic always has
a concrete policy to evaluate and aligns with the field's declared default — existing
event types created before this setting existed behave as host-only-mandatory.

---

## Data Access

### Field exposure: `eventType.requires-cancellation-reason-exposed`

*(Origin: docs/design.md — "Data Flow", lines 56–63)*

- **Field exposed:** `EventType.requiresCancellationReason`.
- **Mechanism:** query select.
- **In:** the `getEventTypesFromDB` read path.

The `requiresCancellationReason` field is included in the projection of the
`getEventTypesFromDB` query, so the setting is read out of the database and made available
to the cancellation validation logic that consumes it.

---

## Architecture Decisions

### ADR-001: Store in Database Column vs Metadata JSON

*(Origin: docs/decisions.md — "ADR-001: Store in Database Column vs Metadata JSON / Decision", lines 14–23)*

- **Category:** persistence strategy.
- **Decision (chosen):** store `requiresCancellationReason` as a **dedicated database
  column**.
- **Rejected alternative:** storing it in a **metadata JSON** blob.
- **Reason:** This is a core booking-flow setting (in the same family as
  `disableCancelling` / `requiresConfirmation`); a dedicated column is type-safe at the
  database level, is cleaner to query in the cancellation validation logic, and is
  consistent with how similar settings are already stored.
- **Consequences:**
  - Requires a database migration.
  - Yields type-safe enum values.
  - Allows direct column access in queries (no JSON parsing).

---

## Traceability Summary

| Artifact | Kind | Origin |
|---|---|---|
| `CancellationReasonRequirement` | enum | docs/design.md — Technical Design / Database Changes (21–27) |
| `EventType` | entity | docs/design.md — Technical Design / Database Changes (19–29) |
| `booking.cancellation-reason-required-host` | validation-rule | docs/design.md — Technical Design / API Changes (31–36) |
| `booking.cancellation-reason-required-attendee` | validation-rule | docs/design.md — Technical Design / API Changes (31–36) |
| `eventType.requires-cancellation-reason-default` | fallback | docs/design.md — Edge Cases (68–73) |
| `eventType.requires-cancellation-reason-exposed` | field-exposure | docs/design.md — Data Flow (56–63) |
| `persistence.requiresCancellationReason` | architecture-decision | docs/decisions.md — ADR-001 / Decision (14–23) |
