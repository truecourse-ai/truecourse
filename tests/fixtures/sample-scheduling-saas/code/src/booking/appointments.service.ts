import { prisma } from '../shared/db.js';
import { ApiError } from '../shared/errors.js';
import { recordEvent } from '../shared/outbox.js';
import { appointmentsRepo } from '../shared/repos/appointments.repo.js';
import { providersRepo } from '../shared/repos/providers.repo.js';
import { slotsRepo } from '../shared/repos/slots.repo.js';
import { isTooLate, MAX_RESCHEDULES } from '../shared/time.js';

/**
 * Fetch an appointment and enforce customer ownership (ADR 0001 / booking-app-v2):
 * missing → 404, someone else's → 403.
 */
async function ownedAppointment(id: string, customerId: string) {
  const appt = await appointmentsRepo.findById(id);
  if (!appt) {
    throw new ApiError(404, 'appointment_not_found', 'No such appointment');
  }
  if (appt.customerId !== customerId) {
    throw new ApiError(403, 'forbidden', 'Not your appointment');
  }
  return appt;
}

export const appointmentsService = {
  /** Create an appointment for the authenticated customer (customer flow). */
  async create(input: {
    customerId: string;
    providerId: string;
    slotId: string;
    timezone?: string;
  }) {
    const provider = await providersRepo.findById(input.providerId);
    if (!provider) {
      throw new ApiError(404, 'provider_not_found', 'No such provider');
    }
    const slot = await slotsRepo.findById(input.slotId);
    if (!slot || slot.providerId !== input.providerId) {
      throw new ApiError(422, 'slot_invalid', 'Slot does not exist for this provider');
    }
    if (slot.booked) {
      throw new ApiError(409, 'slot_taken', 'Slot already booked');
    }
    return prisma.$transaction(async (tx) => {
      const appt = await appointmentsRepo.create(
        {
          providerId: input.providerId,
          customerId: input.customerId,
          slotId: slot.id,
          startsAt: slot.startsAt,
          status: 'booked',
          rescheduleCount: 0,
          timezone: input.timezone ?? null,
          createdBy: 'customer',
        },
        tx,
      );
      await slotsRepo.setBooked(slot.id, true, tx);
      await recordEvent(tx, 'appointment.created', {
        appointmentId: appt.id,
        customerId: appt.customerId,
        providerId: appt.providerId,
        source: 'customer',
      });
      return appt;
    });
  },

  /** Move an appointment to another open slot for the same provider. */
  async reschedule(id: string, customerId: string, newSlotId: string) {
    const appt = await ownedAppointment(id, customerId);
    if (appt.status !== 'booked') {
      throw new ApiError(409, 'invalid_state', 'Appointment is not booked');
    }
    if (isTooLate(appt.startsAt)) {
      throw new ApiError(409, 'too_late', 'Inside the 48-hour window');
    }
    if (appt.rescheduleCount >= MAX_RESCHEDULES) {
      throw new ApiError(409, 'reschedule_limit', 'Reschedule limit reached');
    }
    const slot = await slotsRepo.findById(newSlotId);
    if (!slot || slot.providerId !== appt.providerId) {
      throw new ApiError(422, 'slot_invalid', 'Slot does not exist for this provider');
    }
    if (slot.booked) {
      throw new ApiError(409, 'slot_taken', 'Slot already booked');
    }
    return prisma.$transaction(async (tx) => {
      await slotsRepo.setBooked(appt.slotId, false, tx);
      await slotsRepo.setBooked(slot.id, true, tx);
      const updated = await appointmentsRepo.update(
        appt.id,
        { slotId: slot.id, startsAt: slot.startsAt, rescheduleCount: { increment: 1 } },
        tx,
      );
      await recordEvent(tx, 'appointment.rescheduled', {
        appointmentId: updated.id,
        customerId: updated.customerId,
        newStartsAt: updated.startsAt.toISOString(),
      });
      return updated;
    });
  },

  /** Cancel an appointment, recording an optional reason. */
  async cancel(id: string, customerId: string, reason?: string) {
    const appt = await ownedAppointment(id, customerId);
    if (appt.status !== 'booked') {
      throw new ApiError(409, 'invalid_state', 'Appointment is not booked');
    }
    if (isTooLate(appt.startsAt)) {
      throw new ApiError(409, 'too_late', 'Inside the 48-hour window');
    }
    return prisma.$transaction(async (tx) => {
      await slotsRepo.setBooked(appt.slotId, false, tx);
      const updated = await appointmentsRepo.update(
        appt.id,
        { status: 'cancelled', cancellationReason: reason ?? null },
        tx,
      );
      await recordEvent(tx, 'appointment.cancelled', {
        appointmentId: updated.id,
        customerId: updated.customerId,
        reason: reason ?? null,
      });
      return updated;
    });
  },
};
