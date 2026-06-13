# Cancellation Reason Requirement

This feature lets each event type control whether a cancellation reason must be supplied when a booking is cancelled, and by whom. The behavior is governed by a per-event-type setting whose value comes from a fixed set of policy options, with a defined default and a fallback for unset values.

## Data Model

### `EventType.requiresCancellationReason`

The `EventType` entity gains a new field, `requiresCancellationReason`.

- **Type:** `CancellationReasonRequirement` (enum, defined below).
- **Default value:** `MANDATORY_HOST_ONLY`.

Source: `docs/design.md` — "Cancellation Reason Requirement Design / Technical Design / Database Changes" (lines 19–29).

### `CancellationReasonRequirement` enum

The setting may take exactly one of the following four values:

| Value | Meaning |
| --- | --- |
| `MANDATORY_BOTH` | A cancellation reason is required from both the host and the attendee. |
| `MANDATORY_HOST_ONLY` | A cancellation reason is required from the host only. |
| `MANDATORY_ATTENDEE_ONLY` | A cancellation reason is required from the attendee only. |
| `OPTIONAL_BOTH` | A cancellation reason is optional for both the host and the attendee. |

No other values are permitted.

Source: `docs/design.md` — "Cancellation Reason Requirement Design / Technical Design / Database Changes" (lines 19–29).

## Validation Rules

When a cancellation is performed, the `cancellationReason` field is validated based on the event type's `requiresCancellationReason` setting and on who is cancelling (the actor).

### Reason required for the host

- **Field validated:** `cancellationReason`.
- **Actor:** host.
- **Effect:** the field is **required** (must be present).
- **Applies when:** `eventType.requiresCancellationReason` is one of `MANDATORY_BOTH` or `MANDATORY_HOST_ONLY`.

In other words, a host cancelling a booking must supply a cancellation reason whenever the event type mandates a reason from the host (i.e., `MANDATORY_BOTH` or `MANDATORY_HOST_ONLY`).

Source: `docs/design.md` — "Cancellation Reason Requirement Design / Technical Design / API Changes" (lines 31–36).

### Reason required for the attendee

- **Field validated:** `cancellationReason`.
- **Actor:** attendee.
- **Effect:** the field is **required** (must be present).
- **Applies when:** `eventType.requiresCancellationReason` is one of `MANDATORY_BOTH` or `MANDATORY_ATTENDEE_ONLY`.

In other words, an attendee cancelling a booking must supply a cancellation reason whenever the event type mandates a reason from the attendee (i.e., `MANDATORY_BOTH` or `MANDATORY_ATTENDEE_ONLY`).

Source: `docs/design.md` — "Cancellation Reason Requirement Design / Technical Design / API Changes" (lines 31–36).

### Implied behavior

These two rules together yield the following enforcement matrix. A cancellation reason is required from a given actor exactly when the setting names that actor:

| Setting | Host must give reason | Attendee must give reason |
| --- | --- | --- |
| `MANDATORY_BOTH` | Yes | Yes |
| `MANDATORY_HOST_ONLY` | Yes | No |
| `MANDATORY_ATTENDEE_ONLY` | No | Yes |
| `OPTIONAL_BOTH` | No | No |

When the setting is `OPTIONAL_BOTH`, no `cancellationReason` requirement applies to either actor (no rule targets it).

## Edge Cases / Fallback

If `EventType.requiresCancellationReason` is `null` or absent (e.g., for existing event types that predate this field, or records where the value was never set), it is treated as `MANDATORY_HOST_ONLY`.

Source: `docs/design.md` — "Cancellation Reason Requirement Design / Edge Cases" (lines 68–73).

## Architecture Decision — ADR-001: Store in Database Column vs Metadata JSON

- **Category:** persistence strategy.
- **Decision (chosen):** store `requiresCancellationReason` as a **dedicated database column**.
- **Rejected alternative:** storing the value in a metadata JSON blob.
- **Rationale:** This is a core booking-flow setting (in the same family as `disableCancelling` and `requiresConfirmation`). A dedicated column is type-safe at the database level, cleaner to query within the cancellation validation logic, and consistent with how similar settings (`disableCancelling`, `disableRescheduling`) are already stored.
- **Consequences:**
  - Requires a database migration.
  - Provides type-safe enum values.
  - Allows direct column access in queries (no JSON parsing).

Source: `docs/decisions.md` — "Cancellation Reason Requirement Decisions / ADR-001: Store in Database Column vs Metadata JSON / Decision" (lines 14–28).
