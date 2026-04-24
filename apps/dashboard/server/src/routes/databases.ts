import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { resolveGraphForAnalysisId } from '@truecourse/core/services/violation-query';

const router: Router = Router();

// GET /api/repos/:id/databases?analysisId=
// Honors analysisId so historical analyses and diff mode render the
// databases that existed in that analysis's graph (not stale LATEST).
router.get(
  '/:id/databases',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);
      const analysisId = req.query.analysisId as string | undefined;

      const resolved = resolveGraphForAnalysisId(repo.path, analysisId);
      if (!resolved) {
        res.json([]);
        return;
      }
      const { graph } = resolved;

      const result = graph.databases.map((dbRow) => ({
        id: dbRow.id,
        name: dbRow.name,
        type: dbRow.type,
        driver: dbRow.driver,
        tableCount: Array.isArray(dbRow.tables) ? (dbRow.tables as unknown[]).length : 0,
        connectedServices: dbRow.connectedServices,
        connections: graph.databaseConnections
          .filter((c) => c.databaseId === dbRow.id)
          .map((c) => ({ serviceId: c.serviceId, driver: c.driver })),
      }));

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/repos/:id/databases/:dbId/schema?analysisId=
router.get(
  '/:id/databases/:dbId/schema',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const dbId = req.params.dbId as string;
      const repo = resolveProjectForRequest(id);
      const analysisId = req.query.analysisId as string | undefined;

      const resolved = resolveGraphForAnalysisId(repo.path, analysisId);
      if (!resolved) throw createAppError('Database not found', 404);

      const dbRow = resolved.graph.databases.find((d) => d.id === dbId);
      if (!dbRow) throw createAppError('Database not found', 404);

      res.json({
        id: dbRow.id,
        name: dbRow.name,
        type: dbRow.type,
        driver: dbRow.driver,
        tables: dbRow.tables ?? [],
        relations: dbRow.dbRelations ?? [],
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
