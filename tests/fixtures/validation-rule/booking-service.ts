/**
 * Realistic booking-cancellation guard. The cancellation reason is only
 * required when the event type's policy mandates it AND the actor is the
 * host. This is a setting-gated, conditional field-requiredness rule — the
 * shape the validation-rule extractor recognizes.
 */

export type CancellationReasonPolicy = 'OPTIONAL' | 'MANDATORY' | 'HIDDEN';

export interface EventType {
  id: string;
  title: string;
  requiresCancellationReason: CancellationReasonPolicy;
}

export class ValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CancelBookingInput {
  bookingId: string;
  cancellationReason?: string;
}

/**
 * Throws when a host cancels a booking on an event type whose policy makes
 * the cancellation reason mandatory but no reason was supplied.
 */
export function validateCancellation(
  eventType: EventType,
  actor: string,
  input: CancelBookingInput,
): void {
  const cancellationReason = input.cancellationReason;
  if (
    eventType.requiresCancellationReason === 'MANDATORY' &&
    actor === 'host' &&
    !cancellationReason
  ) {
    throw new ValidationError(
      'cancellation_reason_required',
      'A cancellation reason is required for this event type.',
    );
  }
}
