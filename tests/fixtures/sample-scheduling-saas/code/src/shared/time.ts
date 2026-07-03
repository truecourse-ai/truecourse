/**
 * Time-window rules shared by the booking flows. All math is on UTC instants
 * (ADR 0003) — the customer-seen `timezone` is display metadata and must never
 * enter these calculations.
 */

/** Hours a customer has to self-service before an appointment starts (booking-app-v2). */
export const CANCELLATION_WINDOW_HOURS = 48;

/** Max times a customer may reschedule one appointment (booking-app-v2). */
export const MAX_RESCHEDULES = 3;

/** Hours between `now` and `startsAt`. Negative once the appointment is in the past. */
export function hoursUntil(startsAt: Date, now: Date = new Date()): number {
  return (startsAt.getTime() - now.getTime()) / 3_600_000;
}

/**
 * True when the appointment is at or inside the 48-hour window and can no
 * longer be cancelled or rescheduled by the customer (→ `409 too_late`).
 */
export function isTooLate(startsAt: Date, now: Date = new Date()): boolean {
  return hoursUntil(startsAt, now) <= CANCELLATION_WINDOW_HOURS;
}
