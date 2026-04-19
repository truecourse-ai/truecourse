import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '../middleware/error.js';
import {
  computeFlowSeverities,
  enrichFlowWithLLM,
  getFlowFromLatest,
} from '../services/flow.service.js';
import { resolveProjectForRequest } from '../config/current-project.js';
import {
  readActiveViolationsForAnalysisId,
  resolveGraphForAnalysisId,
} from '../services/violation-query.service.js';

const router: Router = Router();

// GET /api/repos/:id/flows — flows for LATEST, a historical analysis, or the
// current diff (working-tree graph). Severities are computed against the
// active violation set that matches the selected analysisId.
router.get(
  '/:id/flows',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);
      const analysisId = req.query.analysisId as string | undefined;

      const resolved = resolveGraphForAnalysisId(repo.path, analysisId);
      if (!resolved) return res.json({ flows: [], severities: {} });

      const violations = readActiveViolationsForAnalysisId(repo.path, analysisId) ?? [];
      res.json({
        flows: resolved.graph.flows,
        severities: computeFlowSeverities(resolved.graph, violations),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/repos/:id/flows/:flowId — single flow
router.get(
  '/:id/flows/:flowId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const flowId = req.params.flowId as string;
      const repo = resolveProjectForRequest(id);
      const analysisId = req.query.analysisId as string | undefined;

      const resolved = resolveGraphForAnalysisId(repo.path, analysisId);
      if (!resolved) throw createAppError('Flow not found', 404);

      const flow = resolved.graph.flows.find((f) => f.id === flowId);
      if (!flow) throw createAppError('Flow not found', 404);
      res.json(flow);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/repos/:id/flows/:flowId/enrich — trigger LLM enrichment.
// Scoped to LATEST because the enrichment persists back to LATEST.json;
// historical and diff views don't have a persistence target.
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
