import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { repos } from '../db/schema.js';
import { createAppError } from '../middleware/error.js';
import {
  getTrend,
  getBreakdown,
  getTopOffenders,
  getResolution,
} from '../services/analytics.service.js';

const router: Router = Router();

// GET /api/repos/:id/analytics/trend
router.get(
  '/:id/analytics/trend',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const [repo] = await db.select().from(repos).where(eq(repos.id, id)).limit(1);
      if (!repo) throw createAppError('Repo not found', 404);

      const result = await getTrend(id, branch, limit);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/repos/:id/analytics/breakdown
router.get(
  '/:id/analytics/breakdown',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;

      const [repo] = await db.select().from(repos).where(eq(repos.id, id)).limit(1);
      if (!repo) throw createAppError('Repo not found', 404);

      const analysisId = req.query.analysisId as string | undefined;
      const result = await getBreakdown(id, branch, analysisId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/repos/:id/analytics/top-offenders
router.get(
  '/:id/analytics/top-offenders',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;

      const [repo] = await db.select().from(repos).where(eq(repos.id, id)).limit(1);
      if (!repo) throw createAppError('Repo not found', 404);

      const analysisId = req.query.analysisId as string | undefined;
      const result = await getTopOffenders(id, branch, analysisId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/repos/:id/analytics/resolution
router.get(
  '/:id/analytics/resolution',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;

      const [repo] = await db.select().from(repos).where(eq(repos.id, id)).limit(1);
      if (!repo) throw createAppError('Repo not found', 404);

      const result = await getResolution(id, branch);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
