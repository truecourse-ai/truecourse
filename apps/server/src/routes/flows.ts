import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { analyses, flows } from '../db/schema.js';
import { createAppError } from '../middleware/error.js';
import { getFlowsForAnalysis, getFlowWithSteps, enrichFlowWithLLM, getFlowSeverities } from '../services/flow.service.js';
import { resolveProjectForRequest } from '../config/current-project.js';

/** SQL filter to exclude diff analyses */
const notDiffAnalysis = sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS NOT TRUE`;

const router: Router = Router();

// GET /api/repos/:id/flows — list flows for latest analysis
router.get(
  '/:id/flows',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      resolveProjectForRequest(id);

      // Find latest non-diff analysis
      const [latestAnalysis] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(notDiffAnalysis)
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      if (!latestAnalysis) {
        return res.json({ flows: [], severities: {} });
      }

      const [result, severities] = await Promise.all([
        getFlowsForAnalysis(latestAnalysis.id),
        getFlowSeverities(latestAnalysis.id),
      ]);
      res.json({ flows: result, severities });
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
      const flowId = req.params.flowId as string;
      const flow = await getFlowWithSteps(flowId);

      if (!flow) {
        throw createAppError('Flow not found', 404);
      }

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
      const flowId = req.params.flowId as string;

      const [flow] = await db
        .select()
        .from(flows)
        .where(eq(flows.id, flowId))
        .limit(1);

      if (!flow) {
        throw createAppError('Flow not found', 404);
      }

      await enrichFlowWithLLM(flowId);

      const enriched = await getFlowWithSteps(flowId);
      res.json(enriched);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
