import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '../middleware/error.js';
import {
  computeFlowSeverities,
  enrichFlowWithLLM,
  getFlowFromLatest,
  getFlowsFromLatest,
} from '../services/flow.service.js';
import { resolveProjectForRequest } from '../config/current-project.js';
import { readLatest } from '../lib/analysis-store.js';

const router: Router = Router();

// GET /api/repos/:id/flows — list flows for the LATEST analysis
router.get(
  '/:id/flows',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);
      const latest = readLatest(repo.path);
      if (!latest) return res.json({ flows: [], severities: {} });
      res.json({
        flows: latest.graph.flows,
        severities: computeFlowSeverities(latest),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/repos/:id/flows/:flowId — single flow with steps
router.get(
  '/:id/flows/:flowId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const flowId = req.params.flowId as string;
      const repo = resolveProjectForRequest(id);
      const flow = getFlowFromLatest(repo.path, flowId);
      if (!flow) throw createAppError('Flow not found', 404);
      res.json(flow);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/repos/:id/flows/:flowId/enrich — trigger LLM enrichment
router.post(
  '/:id/flows/:flowId/enrich',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const flowId = req.params.flowId as string;
      const repo = resolveProjectForRequest(id);
      const existing = getFlowFromLatest(repo.path, flowId);
      if (!existing) throw createAppError('Flow not found', 404);

      await enrichFlowWithLLM(repo.path, flowId);

      const enriched = getFlowFromLatest(repo.path, flowId);
      res.json(enriched);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
