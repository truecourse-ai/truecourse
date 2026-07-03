import express from 'express';
import { asyncHandler } from '../shared/errors.js';
import { qDate } from '../shared/http.js';
import { providersService } from './providers.service.js';

const router = express.Router();

// GET /api/providers — list bookable providers.
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.status(200).json(await providersService.list());
  }),
);

// GET /api/providers/{id}/slots — open availability over an optional UTC window.
router.get(
  '/providers/:id/slots',
  asyncHandler(async (req, res) => {
    const slots = await providersService.openSlots(
      req.params.id,
      qDate(req.query.from),
      qDate(req.query.to),
    );
    res.status(200).json(slots);
  }),
);

export default router;
