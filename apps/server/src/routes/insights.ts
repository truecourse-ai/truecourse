import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database.js';
import {
  repos,
  analyses,
  services,
  serviceDependencies,
  databases,
  modules,
  methods,
  insights,
} from '../db/schema.js';
import { createAppError } from '../middleware/error.js';
import { generateInsights } from '../services/insight.service.js';
import { emitInsightsReady } from '../socket/handlers.js';

const router: Router = Router();

// POST /api/repos/:id/insights - Generate LLM insights
router.post(
  '/:id/insights',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Get latest analysis
      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(eq(analyses.repoId, id))
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      if (latestAnalysis.length === 0) {
        throw createAppError('No analysis found. Run analysis first.', 400);
      }

      const analysis = latestAnalysis[0];

      // Get services, dependencies, and databases for the analysis
      const analysisServices = await db
        .select()
        .from(services)
        .where(eq(services.analysisId, analysis.id));

      const analysisDatabases = await db
        .select()
        .from(databases)
        .where(eq(databases.analysisId, analysis.id));

      const analysisDeps = await db
        .select()
        .from(serviceDependencies)
        .where(eq(serviceDependencies.analysisId, analysis.id));

      // Build service name map for dependency lookup
      const serviceNameMap = new Map(
        analysisServices.map((s) => [s.id, s.name])
      );

      // Build database ID map
      const dbIdMap = new Map(
        analysisDatabases.map((d) => [d.name, d.id])
      );

      // Generate insights via LLM
      const generatedInsights = await generateInsights({
        architecture: analysis.architecture,
        services: analysisServices.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          framework: s.framework || undefined,
          fileCount: s.fileCount || 0,
          layerSummary: s.layerSummary,
        })),
        dependencies: analysisDeps.map((d) => ({
          sourceServiceName: serviceNameMap.get(d.sourceServiceId) || 'unknown',
          targetServiceName: serviceNameMap.get(d.targetServiceId) || 'unknown',
          dependencyCount: d.dependencyCount,
          dependencyType: d.dependencyType,
        })),
        databases: analysisDatabases.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          driver: d.driver,
          tableCount: (d.tables as unknown[])?.length || 0,
          connectedServices: (d.connectedServices as string[]) || [],
          tables: d.tables as { name: string; columns: { name: string; type: string; isNullable?: boolean; isPrimaryKey?: boolean; isForeignKey?: boolean; referencesTable?: string }[] }[],
          relations: d.dbRelations as { sourceTable: string; targetTable: string; foreignKeyColumn: string }[],
        })),
      });

      const { insights: generatedInsightsList, serviceDescriptions } = generatedInsights;

      // Save insights to database
      const savedInsights = [];
      for (const insight of generatedInsightsList) {
        const [saved] = await db
          .insert(insights)
          .values({
            id: uuidv4(),
            repoId: id,
            analysisId: analysis.id,
            type: insight.type,
            title: insight.title,
            content: insight.content,
            severity: insight.severity,
            targetServiceId: insight.targetServiceId || null,
            targetDatabaseId: insight.targetDatabaseId || null,
            targetTable: insight.targetTable || null,
            fixPrompt: insight.fixPrompt || null,
          })
          .returning();

        savedInsights.push(saved);
      }

      // Save service descriptions
      for (const desc of serviceDescriptions) {
        if (desc.id) {
          await db
            .update(services)
            .set({ description: desc.description })
            .where(eq(services.id, desc.id));
        }
      }

      emitInsightsReady(id, analysis.id);

      res.status(201).json(savedInsights);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/insights - Get insights
router.get(
  '/:id/insights',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Find the relevant analysis
      const conditions = [eq(analyses.repoId, id)];
      if (branch) {
        conditions.push(eq(analyses.branch, branch));
      }

      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(and(...conditions))
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      if (latestAnalysis.length === 0) {
        res.json([]);
        return;
      }

      const analysis = latestAnalysis[0];

      const analysisInsights = await db
        .select({
          id: insights.id,
          type: insights.type,
          title: insights.title,
          content: insights.content,
          severity: insights.severity,
          targetServiceId: insights.targetServiceId,
          targetServiceName: services.name,
          targetDatabaseId: insights.targetDatabaseId,
          targetDatabaseName: databases.name,
          targetModuleId: insights.targetModuleId,
          targetModuleName: modules.name,
          targetMethodId: insights.targetMethodId,
          targetMethodName: methods.name,
          targetTable: insights.targetTable,
          fixPrompt: insights.fixPrompt,
          createdAt: insights.createdAt,
        })
        .from(insights)
        .leftJoin(services, eq(insights.targetServiceId, services.id))
        .leftJoin(databases, eq(insights.targetDatabaseId, databases.id))
        .leftJoin(modules, eq(insights.targetModuleId, modules.id))
        .leftJoin(methods, eq(insights.targetMethodId, methods.id))
        .where(eq(insights.analysisId, analysis.id))
        .orderBy(desc(insights.createdAt));

      res.json(analysisInsights);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
