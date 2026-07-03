import { ApiError } from '../shared/errors.js';
import { appointmentsRepo } from '../shared/repos/appointments.repo.js';
import { refundsRepo } from '../shared/repos/refunds.repo.js';

/** A refund is allowed only on these appointment states (ops-console.md). */
const REFUNDABLE = new Set(['cancelled', 'no_show']);

export const refundsService = {
  /**
   * Record a refund intent against a cancelled/no-show appointment. Money moves
   * through the external PSP, which later drives the Refund `status`; the console
   * only records the intent (`pending`) — ops-console.md.
   */
  async issue(input: {
    agentId: string;
    appointmentId: string;
    amountCents: number;
    reason: string;
  }) {
    const appt = await appointmentsRepo.findById(input.appointmentId);
    if (!appt) {
      throw new ApiError(404, 'appointment_not_found', 'No such appointment');
    }
    if (!REFUNDABLE.has(appt.status)) {
      throw new ApiError(409, 'invalid_state', 'Appointment is not cancelled or no_show');
    }
    if (input.amountCents <= 0 || input.reason.trim().length === 0) {
      throw new ApiError(
        422,
        'amount_invalid',
        'amountCents must be a positive integer and reason is required',
      );
    }
    return refundsRepo.create({
      appointmentId: appt.id,
      amountCents: input.amountCents,
      reason: input.reason,
      status: 'pending',
      agentId: input.agentId,
    });
  },
};
