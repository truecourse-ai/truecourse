# Configurable Cancellation Reason Requirement

> Reconstructed from contract files. Source: `docs/design.md` and `docs/decisions.md`.

## Overview

Add a dropdown setting in the Event Type **Advanced settings** that allows hosts to
configure **when cancellation reasons are required** from hosts and/or attendees.

Previously, whether a cancellation reason was required appears to have been hardcoded
(see `hostMissingCancellationReason` logic in the Cancel Booking component). This feature
makes that requirement configurable per event type.

(Origin: `docs/design.md` → "Overview", lines 3–5.)

## Data Model

### Enum: `CancellationReasonRequirement`

A Prisma enum with exactly four values:

| Value | Meaning |
|---|---|
| `MANDATORY_BOTH` | A cancellation reason is mandatory for both the host and the attendee. |
| `MANDATORY_HOST_ONLY` | A cancellation reason is mandatory for the host only. **(Default.)** |
| `MANDATORY_ATTENDEE_ONLY` | A cancellation reason is mandatory for the attendee only. |
| `OPTIONAL_BOTH` | A cancellation reason is optional for both parties. |

(Origin: `docs/design.md` → "Technical Design / Database Changes", lines 21–26.)

### Entity: `EventType`

Add a new field to the `EventType` model:

- **`requiresCancellationReason`**: `CancellationReasonRequirement` (enum)
  - **Default:** `MANDATORY_HOST_ONLY`

(Origin: `docs/design.md` → "Technical Design / Database Changes", lines 19–29.)

### Storage Decision (ADR-001)

Persist `requiresCancellationReason` using a **dedicated database column backed by a
Prisma enum** (`CancellationReasonRequirement`) — **not** a metadata JSON field.

(Origin: `docs/decisions.md` → "ADR-001 / Decision", lines 14–23.)

## UI Changes

### Event Type Settings — Advanced Tab

In `apps/web/modules/event-types/components/tabs/advanced/EventAdvancedTab.tsx`, add a
dropdown:

- **Placement:** after the **Booking Questions** section and before
  `RequiresConfirmationController`.
- **Label:** "Require cancellation reason"
- **Description:** "Ask for a reason when someone cancels a booking"
- **Options:**
  - Mandatory for both
  - Mandatory for host only (default)
  - Mandatory for attendee only
  - Optional for both

### Cancel Booking Component

In `apps/web/components/booking/CancelBooking.tsx`:

- Add a `requiresCancellationReason` prop.
- Replace the existing hardcoded `hostMissingCancellationReason` logic with
  **configurable validation** driven by the setting.
- Show a **required indicator** on the cancellation-reason textarea when a reason is
  required.

(Origin: `docs/design.md` → "Technical Design / UI Changes", lines 37–54.)

## API / Server-Side Validation

`handleCancelBooking` (`packages/features/bookings/lib/handleCancelBooking.ts`) must
validate the cancellation reason based on:

1. The event type's `requiresCancellationReason` setting, **and**
2. Who is cancelling (host vs. attendee).

The validation enforces the matrix implied by the enum: e.g. `MANDATORY_BOTH` requires a
reason from either party, `MANDATORY_HOST_ONLY` only when the host cancels,
`MANDATORY_ATTENDEE_ONLY` only when the attendee cancels, and `OPTIONAL_BOTH` never
requires one.

(Origin: `docs/design.md` → "Technical Design / API Changes", lines 31–35.)

## Data Flow / Prop Threading

`requiresCancellationReason` flows from the `EventType` DB column through to the booking
views and the cancel dialog:

1. **`getEventTypesFromDB`** (`apps/web/lib/booking.ts`) — must **include the field in
   its `select`**.
2. Threaded through **page props** into booking views.
3. **`CancelBooking`** uses it for validation.

Prop threading is required through all of:

- `apps/web/lib/booking.ts`
- `apps/web/modules/bookings/views/bookings-single-view.tsx`
- `apps/web/components/dialog/CancelBookingDialog.tsx`

(Origin: `docs/design.md` → "Data Flow", lines 56–66.)

## Edge Cases / Fallback Behavior

- **Platform users** respect the setting.
- The setting applies to **team bookings**, regardless of team context.
- A **null** column value defaults to **`MANDATORY_HOST_ONLY`** behavior.
- **Default event types** (those with no `eventTypeId`) use the default
  **`MANDATORY_HOST_ONLY`**.

(Origin: `docs/design.md` → "Edge Cases", lines 68–73.)

## Out of Scope / Forbidden

The following are explicitly **out of scope** for this feature and must **not** be
introduced (enforced as forbidden file-glob artifacts):

- **Cancellation reason analytics / reporting** — any file matching
  `**/*[Cc]ancellation[Rr]eason*[Aa]nalytics*`.
  *Reason analytics/reporting is explicitly out of scope.*
- **Custom cancellation reason dropdown options** — any file matching
  `**/*[Cc]ustom[Cc]ancellationReason*`.
  *Custom reason dropdown options are explicitly out of scope.*
- **Reschedule reason configuration** — any file matching
  `**/*[Rr]escheduleReason*`.
  *Reschedule reason configuration is explicitly out of scope (a separate feature).*

(Origin: `docs/design.md` → "Out of Scope", lines 75–79.)
