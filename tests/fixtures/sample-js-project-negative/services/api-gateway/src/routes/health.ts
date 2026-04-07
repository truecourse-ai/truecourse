import { Router } from 'express';
import { HealthService } from '../services/health.service';

export const healthRouter = Router();
const healthService = new HealthService();

// VIOLATION: architecture/deterministic/route-without-auth-middleware
healthRouter.get('/', (_req, res) => {
  res.json(healthService.check());
});
