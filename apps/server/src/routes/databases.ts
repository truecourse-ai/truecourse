import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../config/database.js';
import { analyses, databases, databaseConnections } from '../db/schema.js';
import { createAppError } from '../middleware/error.js';
import { resolveProjectForRequest } from '../config/current-project.js';

const router: Router = Router();

// GET /api/repos/:id/databases - List detected databases
router.get(
  '/:id/databases',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      resolveProjectForRequest(id);

      const conditions = [] as ReturnType<typeof eq>[];
      if (branch) {
        conditions.push(eq(analyses.branch, branch));
      }

      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      if (latestAnalysis.length === 0) {
        res.json([]);
        return;
      }

      const analysisDatabases = await db
        .select()
        .from(databases)
        .where(eq(databases.analysisId, latestAnalysis[0].id));

      const connections = await db
        .select()
        .from(databaseConnections)
        .where(eq(databaseConnections.analysisId, latestAnalysis[0].id));

      const result = analysisDatabases.map((dbRow) => ({
        id: dbRow.id,
        name: dbRow.name,
        type: dbRow.type,
        driver: dbRow.driver,
        tableCount: Array.isArray(dbRow.tables) ? dbRow.tables.length : 0,
        connectedServices: dbRow.connectedServices,
        connections: connections
          .filter((c) => c.databaseId === dbRow.id)
          .map((c) => ({ serviceId: c.serviceId, driver: c.driver })),
      }));

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/databases/:dbId/schema - Get database schema details
router.get(
  '/:id/databases/:dbId/schema',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dbId = req.params.dbId as string;

      const [dbRow] = await db
        .select()
        .from(databases)
        .where(eq(databases.id, dbId))
        .limit(1);

      if (!dbRow) {
        throw createAppError('Database not found', 404);
      }

      res.json({
        id: dbRow.id,
        name: dbRow.name,
        type: dbRow.type,
        driver: dbRow.driver,
        tables: dbRow.tables || [],
        relations: dbRow.dbRelations || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
