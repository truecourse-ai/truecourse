import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../shared/errors.js';
import { parseBody } from '../shared/http.js';
import { refundsService } from './refunds.service.js';

const router = express.Router();

const RefundBody = z.object({
  amountCents: z.number().int(),
  reason: z.string(),
});

// POST /ops/appointments/{id}/refund — issue a refund against a cancelled/no-show appointment.
router.post(
  '/appointments/:id/refund',
  asyncHandler(async (req, res) => {
    const body = parseBody(RefundBody, req.body);
    const refund = await refundsService.issue({
      agentId: req.agent!.agentId,
      appointmentId: req.params.id,
      ...body,
    });
    res.status(201).json(refund);
  }),
);

export default router;
