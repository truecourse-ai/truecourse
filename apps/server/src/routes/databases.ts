import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppError } from '../middleware/error.js';
import { resolveProjectForRequest } from '../config/current-project.js';
import { readLatest } from '../lib/analysis-store.js';

const router: Router = Router();

// GET /api/repos/:id/databases — databases in LATEST
router.get(
  '/:id/databases',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);
      const latest = readLatest(repo.path);
      if (!latest) {
        res.json([]);
        return;
      }

      const result = latest.graph.databases.map((dbRow) => ({
        id: dbRow.id,
        name: dbRow.name,
        type: dbRow.type,
        driver: dbRow.driver,
        tableCount: Array.isArray(dbRow.tables) ? (dbRow.tables as unknown[]).length : 0,
        connectedServices: dbRow.connectedServices,
        connections: latest.graph.databaseConnections
          .filter((c) => c.databaseId === dbRow.id)
          .map((c) => ({ serviceId: c.serviceId, driver: c.driver })),
      }));

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/repos/:id/databases/:dbId/schema — details
router.get(
  '/:id/databases/:dbId/schema',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const dbId = req.params.dbId as string;
      const repo = resolveProjectForRequest(id);
      const latest = readLatest(repo.path);
      if (!latest) throw createAppError('Database not found', 404);
      const dbRow = latest.graph.databases.find((d) => d.id === dbId);
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
