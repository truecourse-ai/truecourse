import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and, sql, count } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../config/database.js';
import {
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
import { resolveProjectForRequest } from '../config/current-project.js';

/** SQL filter to exclude diff analyses */
const notDiffAnalysis = sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS NOT TRUE`;

const router: Router = Router();

// POST /api/repos/:id/violations - Generate LLM violations
router.post(
  '/:id/violations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      resolveProjectForRequest(id);

      // Get latest non-diff analysis
      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(notDiffAnalysis)
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
            id: randomUUID(),
            analysisId: analysis.id,
            type: violation.type,
            title: violation.title,
            content: violation.content,
            severity: violation.severity,
            targetServiceId: violation.targetServiceId || null,
            targetDatabaseId: violation.targetDatabaseId || null,
            targetTable: violation.targetTable || null,
            fixPrompt: violation.fixPrompt || null,
            ruleKey: violation.ruleKey || 'unknown',
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
      const repo = resolveProjectForRequest(id);

      let analysis;

      if (analysisIdParam) {
        const [specific] = await db
          .select()
          .from(analyses)
          .where(eq(analyses.id, analysisIdParam))
          .limit(1);
        if (!specific) {
          res.json([]);
          return;
        }
        analysis = specific;
      } else {
        // Find the latest non-diff analysis
        const conditions = [notDiffAnalysis];
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

      // Build query conditions
      const queryConditions: ReturnType<typeof eq>[] = [eq(violations.analysisId, analysis.id)];

      // Optional file filter
      const fileParam = req.query.file as string | undefined;
      if (fileParam) {
        const absPath = fileParam.startsWith('/') ? fileParam : `${repo.path}/${fileParam}`;
        queryConditions.push(eq(violations.filePath, absPath));
      }

      // Status filter: default to active violations only
      const statusParam = req.query.status as string | undefined;
      if (statusParam === 'resolved') {
        queryConditions.push(eq(violations.status, 'resolved'));
      } else if (statusParam === 'all') {
        // No status filter — return all
      } else {
        // Default: active violations only (new + unchanged)
        queryConditions.push(
          sql`${violations.status} IN ('new', 'unchanged')`,
        );
      }

      // Severity ordering for consistent sort
      const severityOrder = sql`CASE ${violations.severity}
        WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
        WHEN 'low' THEN 3 WHEN 'info' THEN 4 ELSE 5 END`;

      const selectFields = {
        id: violations.id,
        type: violations.type,
        title: violations.title,
        content: violations.content,
        severity: violations.severity,
        status: violations.status,
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
        firstSeenAt: violations.firstSeenAt,
        createdAt: violations.createdAt,
        ruleKey: violations.ruleKey,
        filePath: violations.filePath,
        lineStart: violations.lineStart,
        lineEnd: violations.lineEnd,
        columnStart: violations.columnStart,
        columnEnd: violations.columnEnd,
        snippet: violations.snippet,
      };

      // Pagination
      const limitParam = parseInt(req.query.limit as string) || 0;
      const offsetParam = parseInt(req.query.offset as string) || 0;

      let query = db
        .select(selectFields)
        .from(violations)
        .leftJoin(services, eq(violations.targetServiceId, services.id))
        .leftJoin(databases, eq(violations.targetDatabaseId, databases.id))
        .leftJoin(modules, eq(violations.targetModuleId, modules.id))
        .leftJoin(methods, eq(violations.targetMethodId, methods.id))
        .where(and(...queryConditions))
        .orderBy(severityOrder, desc(violations.createdAt))
        .$dynamic();

      if (limitParam > 0) {
        query = query.limit(limitParam).offset(offsetParam);
      }

      const [analysisViolations, totalResult] = await Promise.all([
        query,
        db.select({ count: count() }).from(violations).where(and(...queryConditions)),
      ]);

      const total = totalResult[0]?.count ?? 0;

      // If pagination requested, return object with total; otherwise return array for backward compat
      if (limitParam > 0 || offsetParam > 0) {
        res.json({ violations: analysisViolations, total });
      } else {
        res.json(analysisViolations);
      }
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/violations/summary - Summary counts by severity and file
router.get(
  '/:id/violations/summary',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const analysisIdParam = req.query.analysisId as string | undefined;
      resolveProjectForRequest(id);

      let analysisId: string;

      if (analysisIdParam) {
        const [specific] = await db
          .select({ id: analyses.id })
          .from(analyses)
          .where(eq(analyses.id, analysisIdParam))
          .limit(1);
        if (!specific) {
          res.json({ total: 0, byFile: {}, bySeverity: {} });
          return;
        }
        analysisId = specific.id;
      } else {
        const [latest] = await db
          .select({ id: analyses.id })
          .from(analyses)
          .where(notDiffAnalysis)
          .orderBy(desc(analyses.createdAt))
          .limit(1);

        if (!latest) {
          res.json({ total: 0, byFile: {}, bySeverity: {} });
          return;
        }
        analysisId = latest.id;
      }

      const rows = await db
        .select({
          filePath: violations.filePath,
          severity: violations.severity,
          count: count(),
        })
        .from(violations)
        .where(and(
          eq(violations.analysisId, analysisId),
          sql`${violations.status} IN ('new', 'unchanged')`,
        ))
        .groupBy(violations.filePath, violations.severity);

      const byFile: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};
      const highestSeverityByFile: Record<string, string> = {};
      const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
      let total = 0;

      for (const row of rows) {
        const c = Number(row.count);
        total += c;
        bySeverity[row.severity] = (bySeverity[row.severity] || 0) + c;

        if (row.filePath) {
          byFile[row.filePath] = (byFile[row.filePath] || 0) + c;
          const current = highestSeverityByFile[row.filePath];
          if (!current || severityOrder.indexOf(row.severity) < severityOrder.indexOf(current)) {
            highestSeverityByFile[row.filePath] = row.severity;
          }
        }
      }

      res.json({ total, byFile, bySeverity, highestSeverityByFile });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
