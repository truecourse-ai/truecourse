import { prisma } from '../shared/db.js';
import { ApiError } from '../shared/errors.js';
import { recordEvent } from '../shared/outbox.js';
import {
  appointmentsRepo,
  type AppointmentFilters,
} from '../shared/repos/appointments.repo.js';
import { customersRepo } from '../shared/repos/customers.repo.js';
import { providersRepo } from '../shared/repos/providers.repo.js';
import { slotsRepo } from '../shared/repos/slots.repo.js';
import { hoursUntil } from '../shared/time.js';

export const opsAppointmentsService = {
  /** Search every appointment across the platform (cursor-paginated). */
  search(filters: AppointmentFilters, opts: { cursor?: string; limit: number }) {
    return appointmentsRepo.search(filters, opts);
  },

  /**
   * An agent books on a customer's behalf (phone booking). Publishes the AGENT
   * variant of `appointment.created` — `source: "agent"` plus `agentId` — a
   * distinct contract from the booking app's customer flow (ops-console.md).
   */
  async createOnBehalf(input: {
    agentId: string;
    providerId: string;
    customerId: string;
    slotId: string;
  }) {
    const provider = await providersRepo.findById(input.providerId);
    if (!provider) {
      throw new ApiError(404, 'provider_not_found', 'No such provider');
    }
    const customer = await customersRepo.findById(input.customerId);
    if (!customer) {
      throw new ApiError(404, 'customer_not_found', 'No such customer');
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
          createdBy: 'agent',
          agentId: input.agentId,
        },
        tx,
      );
      await slotsRepo.setBooked(slot.id, true, tx);
      await recordEvent(tx, 'appointment.created', {
        appointmentId: appt.id,
        customerId: appt.customerId,
        providerId: appt.providerId,
        source: 'agent',
        agentId: input.agentId,
      });
      return appt;
    });
  },

  /**
   * Mark a past, booked appointment as a no-show. Transitions status only — the
   * event set (ADR 0002) has no `no_show` event, so none is published (open
   * question in ops-console.md).
   */
  async markNoShow(id: string) {
    const appt = await appointmentsRepo.findById(id);
    if (!appt) {
      throw new ApiError(404, 'appointment_not_found', 'No such appointment');
    }
    if (appt.status !== 'booked' || hoursUntil(appt.startsAt) > 0) {
      throw new ApiError(
        409,
        'invalid_state',
        'Only a booked appointment whose start has passed can be a no-show',
      );
    }
    return appointmentsRepo.update(id, { status: 'no_show' });
  },
};
