import { Router } from 'express';
import { checkHealth } from '../services/health.service';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json(checkHealth());
});
