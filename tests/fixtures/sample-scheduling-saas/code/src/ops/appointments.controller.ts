import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../shared/errors.js';
import { parseBody, qDate, qStr } from '../shared/http.js';
import { opsAppointmentsService } from './appointments.service.js';

const router = express.Router();

const Uuid = z.string().uuid();
const CreateBody = z.object({
  providerId: Uuid,
  customerId: Uuid,
  slotId: Uuid,
});

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /ops/appointments — search across all appointments, cursor-paginated.
router.get(
  '/appointments',
  asyncHandler(async (req, res) => {
    const rawLimit = Number(req.query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
    const limit = Math.min(rawLimit, MAX_LIMIT);
    const page = await opsAppointmentsService.search(
      {
        providerId: qStr(req.query.providerId),
        customerId: qStr(req.query.customerId),
        status: qStr(req.query.status),
        from: qDate(req.query.from),
        to: qDate(req.query.to),
      },
      { cursor: qStr(req.query.cursor), limit },
    );
    res.status(200).json(page);
  }),
);

// POST /ops/appointments — agent books on a customer's behalf.
router.post(
  '/appointments',
  asyncHandler(async (req, res) => {
    const body = parseBody(CreateBody, req.body);
    const appt = await opsAppointmentsService.createOnBehalf({
      agentId: req.agent!.agentId,
      ...body,
    });
    res.status(201).json(appt);
  }),
);

// POST /ops/appointments/{id}/no-show — mark a past booked appointment no_show.
router.post(
  '/appointments/:id/no-show',
  asyncHandler(async (req, res) => {
    const appt = await opsAppointmentsService.markNoShow(req.params.id);
    res.status(200).json(appt);
  }),
);

export default router;
