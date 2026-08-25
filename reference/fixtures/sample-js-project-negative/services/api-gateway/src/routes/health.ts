import { Router } from 'express';
import { HealthService } from '../services/health.service';

export const healthRouter = Router();
const healthService = new HealthService();

// NOTE: architecture/deterministic/route-without-auth-middleware — not detected by visitor in this file
healthRouter.get('/', (_req, res) => {
  res.json(healthService.check());
});
