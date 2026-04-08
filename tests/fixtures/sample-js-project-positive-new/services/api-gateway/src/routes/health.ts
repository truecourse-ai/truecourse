import { Router } from 'express';
import { HealthService } from '../services/health.service';
import { authMiddleware } from '../middleware/auth';

export const healthRouter = Router();
const healthService = new HealthService();

healthRouter.get('/', authMiddleware, (_req, res) => {
  res.json(healthService.check());
});
