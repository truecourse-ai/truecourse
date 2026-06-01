import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { ErrorEnvelope } from '../types.js';
import { customersService } from '../services/customers.service.js';
import { customersRepo } from '../repos/customers.repo.js';
import { loyaltyRepo } from '../repos/loyalty.repo.js';

const router = express.Router();

const UuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

router.post('/customers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'validation_failed',
          message: 'Request body failed validation',
          details: { issues: parsed.error.issues },
        },
      } satisfies ErrorEnvelope);
    }
    const r = await customersService.create(parsed.data);
    if (!r.ok) {
      return res.status(409).json({
        error: { code: 'email_taken', message: 'Email already in use' },
      } satisfies ErrorEnvelope);
    }
    res.setHeader('Location', `/api/customers/${r.customer.id}`);
    return res.status(201).json(r.customer);
  } catch (e) {
    return next(e);
  }
});

router.get('/customers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);
    const page = await customersRepo.list({ cursor, limit });
    return res.status(200).json(page);
  } catch (e) {
    return next(e);
  }
});

router.get('/loyalty-tiers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tiers = await loyaltyRepo.listEligibleTiers('is_active = true');
    return res.status(200).json(tiers);
  } catch (e) {
    return next(e);
  }
});

router.get('/customers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!UuidRegex.test(req.params.id)) {
      return res.status(400).json({
        error: { code: 'validation_failed', message: 'id must be a UUID' },
      } satisfies ErrorEnvelope);
    }
    const c = await customersRepo.findById(req.params.id);
    if (!c) {
      return res.status(404).json({
        error: { code: 'customer_not_found', message: 'Customer does not exist' },
      } satisfies ErrorEnvelope);
    }
    return res.status(200).json(c);
  } catch (e) {
    return next(e);
  }
});

export default router;
