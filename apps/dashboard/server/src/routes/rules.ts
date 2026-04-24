import { Router, type Request, type Response } from 'express';
import { getRules } from '@truecourse/core/services/rules';

const router: Router = Router();

// GET /api/rules — return the static rule catalogue (no DB)
router.get('/', async (_req: Request, res: Response) => {
  res.json(await getRules());
});

export default router;
