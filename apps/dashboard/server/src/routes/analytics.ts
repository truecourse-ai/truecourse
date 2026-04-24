import { Router, type Request, type Response, type NextFunction } from 'express';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  getBreakdown,
  getResolution,
  getTopOffenders,
  getTrend,
} from '../services/analytics.service.js';

const router: Router = Router();

// GET /api/repos/:id/analytics/trend
router.get(
  '/:id/analytics/trend',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      const analysisId = req.query.analysisId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const repo = resolveProjectForRequest(id);
      res.json(getTrend(repo.path, branch, limit, analysisId));
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
      const analysisId = req.query.analysisId as string | undefined;
      const repo = resolveProjectForRequest(id);
      res.json(getBreakdown(repo.path, branch, analysisId));
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
      const analysisId = req.query.analysisId as string | undefined;
      const repo = resolveProjectForRequest(id);
      res.json(getTopOffenders(repo.path, branch, analysisId));
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
      const analysisId = req.query.analysisId as string | undefined;
      const repo = resolveProjectForRequest(id);
      res.json(getResolution(repo.path, branch, analysisId));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
