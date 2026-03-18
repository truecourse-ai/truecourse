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
  violations,
} from '../db/schema.js';
import { createAppError } from '../middleware/error.js';
import { generateViolations } from '../services/violation.service.js';
import { emitViolationsReady } from '../socket/handlers.js';

const router: Router = Router();

// POST /api/repos/:id/violations - Generate LLM violations
router.post(
  '/:id/violations',
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

      // Generate violations via LLM
      const generatedViolations = await generateViolations({
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

      const { violations: generatedViolationsList, serviceDescriptions } = generatedViolations;

      // Save violations to database
      const savedViolations = [];
      for (const violation of generatedViolationsList) {
        const [saved] = await db
          .insert(violations)
          .values({
            id: uuidv4(),
            repoId: id,
            analysisId: analysis.id,
            type: violation.type,
            title: violation.title,
            content: violation.content,
            severity: violation.severity,
            targetServiceId: violation.targetServiceId || null,
            targetDatabaseId: violation.targetDatabaseId || null,
            targetTable: violation.targetTable || null,
            fixPrompt: violation.fixPrompt || null,
          })
          .returning();

        savedViolations.push(saved);
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

      emitViolationsReady(id, analysis.id);

      res.status(201).json(savedViolations);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/violations - Get violations
router.get(
  '/:id/violations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      const analysisIdParam = req.query.analysisId as string | undefined;

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      let analysis;

      if (analysisIdParam) {
        const [specific] = await db
          .select()
          .from(analyses)
          .where(and(eq(analyses.id, analysisIdParam), eq(analyses.repoId, id)))
          .limit(1);
        if (!specific) {
          res.json([]);
          return;
        }
        analysis = specific;
      } else {
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
        analysis = latestAnalysis[0];
      }

      const analysisViolations = await db
        .select({
          id: violations.id,
          type: violations.type,
          title: violations.title,
          content: violations.content,
          severity: violations.severity,
          targetServiceId: violations.targetServiceId,
          targetServiceName: services.name,
          targetDatabaseId: violations.targetDatabaseId,
          targetDatabaseName: databases.name,
          targetModuleId: violations.targetModuleId,
          targetModuleName: modules.name,
          targetMethodId: violations.targetMethodId,
          targetMethodName: methods.name,
          targetTable: violations.targetTable,
          fixPrompt: violations.fixPrompt,
          createdAt: violations.createdAt,
        })
        .from(violations)
        .leftJoin(services, eq(violations.targetServiceId, services.id))
        .leftJoin(databases, eq(violations.targetDatabaseId, databases.id))
        .leftJoin(modules, eq(violations.targetModuleId, modules.id))
        .leftJoin(methods, eq(violations.targetMethodId, methods.id))
        .where(eq(violations.analysisId, analysis.id))
        .orderBy(desc(violations.createdAt));

      res.json(analysisViolations);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
