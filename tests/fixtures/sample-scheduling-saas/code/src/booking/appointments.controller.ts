import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../shared/errors.js';
import { parseBody } from '../shared/http.js';
import { appointmentsService } from './appointments.service.js';

const router = express.Router();

const Uuid = z.string().uuid();
const CreateBody = z.object({
  providerId: Uuid,
  slotId: Uuid,
  // IANA tz the customer's client displayed; display only (ADR 0003).
  timezone: z.string().optional(),
});
const RescheduleBody = z.object({ slotId: Uuid });
const CancelBody = z.object({ reason: z.string().optional() });

// POST /api/appointments — create for the authenticated customer.
router.post(
  '/appointments',
  asyncHandler(async (req, res) => {
    const body = parseBody(CreateBody, req.body);
    const appt = await appointmentsService.create({
      customerId: req.customer!.customerId,
      ...body,
    });
    res.status(201).json(appt);
  }),
);

// POST /api/appointments/{id}/reschedule — move to another open slot.
router.post(
  '/appointments/:id/reschedule',
  asyncHandler(async (req, res) => {
    const body = parseBody(RescheduleBody, req.body);
    const appt = await appointmentsService.reschedule(
      req.params.id,
      req.customer!.customerId,
      body.slotId,
    );
    res.status(200).json(appt);
  }),
);

// POST /api/appointments/{id}/cancel — cancel with an optional reason.
router.post(
  '/appointments/:id/cancel',
  asyncHandler(async (req, res) => {
    const body = parseBody(CancelBody, req.body);
    const appt = await appointmentsService.cancel(
      req.params.id,
      req.customer!.customerId,
      body.reason,
    );
    res.status(200).json(appt);
  }),
);

export default router;
