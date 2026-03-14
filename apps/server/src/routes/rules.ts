import { Router, type Request, type Response } from 'express';
import { getAllDefaultRules } from '@truecourse/analyzer';

const router: Router = Router();

// GET /api/rules — return all default analysis rules
router.get('/', (_req: Request, res: Response) => {
  const rules = getAllDefaultRules();
  res.json(rules);
});

export default router;
