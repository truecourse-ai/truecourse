# Reconstructed Spec: Cancellation Reason Requirement on Event Types

> Reconstructed solely from the `.tc` contract files. Every requirement below is traceable to a contract clause; nothing has been invented.

## Overview

This feature lets each **event type** declare whether a **cancellation reason** must be provided when an event of that type is cancelled, and from whom (host, attendee, or both). All contracts originate from `docs/design.md`, specifically the "Technical Design / Database Changes" section (lines 19–29) and the "Out of Scope" section (lines 75–79). The data-model surface is small: one new enum and one new field on the `EventType` entity.

## Data Model

### Enum: `CancellationReasonRequirement`

- Origin: `docs/design.md` → "Technical Design / Database Changes" (lines 21–26).
- An enumeration with exactly four allowed values, in this order:
  1. `MANDATORY_BOTH` — a cancellation reason is required from both the host and the attendee.
  2. `MANDATORY_HOST_ONLY` — a cancellation reason is required only from the host.
  3. `MANDATORY_ATTENDEE_ONLY` — a cancellation reason is required only from the attendee.
  4. `OPTIONAL_BOTH` — a cancellation reason is optional for both host and attendee.
- These four values are the complete, closed set; no other values are permitted.

### Entity: `EventType`

- Origin: `docs/design.md` → "Technical Design / Database Changes" (lines 19–29).
- Gains a new field:
  - **`requiresCancellationReason`** — typed as the `CancellationReasonRequirement` enum above.
    - **Default value: `MANDATORY_HOST_ONLY`.** Newly created or migrated event types that do not specify a value must default to requiring a cancellation reason from the host only.

## Behavioral Intent (derived from the model)

- Each event type carries its own cancellation-reason policy via `requiresCancellationReason`.
- When an event of a given type is cancelled, whether a reason is mandatory is determined by that event type's `requiresCancellationReason` value, scoped to who is performing/affected by the cancellation (host vs. attendee) per the enum semantics above.
- The system-wide default policy (when none is chosen) is "host must provide a reason; attendee need not."

## Out of Scope

All three exclusions originate from `docs/design.md` → "Out of Scope" (lines 75–79) and are encoded as forbidden file-glob artifacts. No source files matching the following patterns should exist for this feature:

1. **Reason analytics / reporting** — pattern `**/*[Cc]ancellation[Rr]eason*[Aa]nalytics*`. Building analytics or reporting over cancellation reasons is explicitly out of scope.
2. **Custom cancellation-reason dropdown options** — pattern `**/*[Cc]ustom[Cc]ancellationReason*`. Allowing users to define custom reason dropdown options is explicitly out of scope.
3. **Reschedule reason configuration** — pattern `**/*[Rr]escheduleReason*`. Configuring reasons for reschedules is explicitly out of scope; it is a separate feature.

These forbidden artifacts bound the feature: it covers *whether a cancellation reason is required* (a fixed four-value policy per event type) and nothing more — not analytics, not custom/user-defined reason values, and not reschedule reasons.
