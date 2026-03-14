import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database.js';
import {
  repos,
  analyses,
  services,
  serviceDependencies,
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

      // Get services and dependencies for the analysis
      const analysisServices = await db
        .select()
        .from(services)
        .where(eq(services.analysisId, analysis.id));

      const analysisDeps = await db
        .select()
        .from(serviceDependencies)
        .where(eq(serviceDependencies.analysisId, analysis.id));

      // Build service name map for dependency lookup
      const serviceNameMap = new Map(
        analysisServices.map((s) => [s.id, s.name])
      );

      // Generate insights via LLM
      const generatedInsights = await generateInsights({
        architecture: analysis.architecture,
        services: analysisServices.map((s) => ({
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
      });

      const { insights: generatedInsightsList, serviceDescriptions } = generatedInsights;

      // Save insights to database
      const savedInsights = [];
      for (const insight of generatedInsightsList) {
        // Find target service ID if targetService name is provided
        let targetServiceId: string | null = null;
        if (insight.targetService) {
          const targetService = analysisServices.find(
            (s) => s.name === insight.targetService
          );
          if (targetService) {
            targetServiceId = targetService.id;
          }
        }

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
            targetServiceId,
            fixPrompt: insight.fixPrompt || null,
          })
          .returning();

        savedInsights.push(saved);
      }

      // Save service descriptions
      for (const desc of serviceDescriptions) {
        const svc = analysisServices.find((s) => s.name === desc.name);
        if (svc) {
          await db
            .update(services)
            .set({ description: desc.description })
            .where(eq(services.id, svc.id));
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
          fixPrompt: insights.fixPrompt,
          createdAt: insights.createdAt,
        })
        .from(insights)
        .leftJoin(services, eq(insights.targetServiceId, services.id))
        .where(eq(insights.analysisId, analysis.id))
        .orderBy(desc(insights.createdAt));

      res.json(analysisInsights);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
