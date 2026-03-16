import { Router, type Request, type Response } from 'express';
import { getRulesFromDb } from '../services/rules.service.js';

const router: Router = Router();

// GET /api/rules — return all analysis rules from database
router.get('/', async (_req: Request, res: Response) => {
  const rules = await getRulesFromDb();
  res.json(rules);
});

export default router;
