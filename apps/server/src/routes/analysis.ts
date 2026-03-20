import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
  repos,
  analyses,
  services,
  serviceDependencies,
  layers,
  layerDependencies,
  violations,
  databases,
  databaseConnections,
  modules,
  methods,
  moduleDeps,
  methodDeps,
  diffChecks,
  codeViolations,
} from '../db/schema.js';
import { AnalyzeRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { simpleGit } from 'simple-git';
import fs from 'node:fs';
import path from 'node:path';
import { runAnalysis, runDeterministicModuleChecks } from '../services/analyzer.service.js';
import { runDiffAnalysis, runDiffViolationCheck } from '../services/diff-check.service.js';
import { persistAnalysisResult, persistCodeViolations } from '../services/analysis-persistence.service.js';
import { detectAndPersistFlows } from '../services/flow.service.js';
import { checkCodeRules, parseFile, detectLanguage } from '@truecourse/analyzer';
import type { CodeViolation } from '@truecourse/shared';
import {
  emitAnalysisProgress,
  emitAnalysisComplete,
  emitViolationsReady,
} from '../socket/handlers.js';
import { buildUnifiedGraph, type GraphLevel } from '../services/graph.service.js';
import { generateViolations } from '../services/violation.service.js';
import type { ModuleViolation } from '@truecourse/analyzer';
import { getEnabledRules } from '../services/rules.service.js';
import { v4 as uuidv4 } from 'uuid';
import { createLLMProvider, type CodeViolationContext } from '../services/llm/provider.js';

/** SQL filter to exclude diff analyses */
const notDiffAnalysis = sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS NOT TRUE`;

const router: Router = Router();

// POST /api/repos/:id/analyze - Trigger analysis
router.post(
  '/:id/analyze',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const parsed = AnalyzeRepoSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createAppError('Invalid request body', 400);
      }

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Detect current branch (never checkout — analyze what's on disk)
      const git = simpleGit(repo.path);
      const branch = (await git.branch()).current || null;

      // Respond immediately, run analysis asynchronously
      res.status(202).json({ message: 'Analysis started', repoId: id, branch });

      // Run analysis in the background
      try {
        emitAnalysisProgress(id, {
          step: 'starting',
          percent: 0,
          detail: 'Starting analysis...',
        });

        const result = await runAnalysis(repo.path, branch ?? undefined, (progress) => {
          emitAnalysisProgress(id, progress);
        });

        // Get previous analysis positions (mapped by service name)
        const prevConditions = [eq(analyses.repoId, id), notDiffAnalysis];
        if (branch) prevConditions.push(eq(analyses.branch, branch));
        const prevAnalyses = await db
          .select()
          .from(analyses)
          .where(and(...prevConditions))
          .orderBy(desc(analyses.createdAt))
          .limit(1);

        let prevPositionsByName: Record<string, { x: number; y: number }> = {};
        let prevLayerPositions: Record<string, { x: number; y: number }> | null = null;
        if (prevAnalyses.length > 0 && prevAnalyses[0].nodePositions) {
          const allPrev = prevAnalyses[0].nodePositions as Record<string, unknown>;
          // Support both namespaced and legacy flat formats
          const prevServicePositions = (allPrev.services || allPrev) as Record<string, { x: number; y: number }>;
          prevLayerPositions = (allPrev.layers as Record<string, { x: number; y: number }>) || null;
          const prevServices = await db
            .select()
            .from(services)
            .where(eq(services.analysisId, prevAnalyses[0].id));
          for (const svc of prevServices) {
            if (prevServicePositions[svc.id]) {
              prevPositionsByName[svc.name] = prevServicePositions[svc.id];
            }
          }
        }

        // Clean up old diff analysis and diff check for this repo
        const oldDiffChecks = await db
          .select({ diffAnalysisId: diffChecks.diffAnalysisId })
          .from(diffChecks)
          .where(eq(diffChecks.repoId, id));
        for (const dc of oldDiffChecks) {
          if (dc.diffAnalysisId) {
            await db.delete(analyses).where(eq(analyses.id, dc.diffAnalysisId));
          }
        }
        await db.delete(diffChecks).where(eq(diffChecks.repoId, id));

        // Persist analysis using shared service
        const { analysisId: newAnalysisId, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap } =
          await persistAnalysisResult({ repoId: id, branch, result });

        const analysis = { id: newAnalysisId };

        // Detect and persist flows
        try {
          await detectAndPersistFlows(newAnalysisId, result);
        } catch (flowError) {
          console.error('[Flows] Detection failed:', flowError instanceof Error ? flowError.message : String(flowError));
        }

        // Load rules from database
        const allRules = await getEnabledRules();

        // Check deterministic module rules
        const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic');
        const moduleViolations: ModuleViolation[] = runDeterministicModuleChecks(result, enabledDeterministic);

        // Run code-level rules (AST visitors) and collect file contents for LLM code rules
        const enabledCodeRules = allRules.filter((r) => r.category === 'code' && r.type === 'deterministic');
        const enabledLlmCodeRules = allRules.filter((r) => r.category === 'code' && r.type === 'llm' && r.prompt);
        const allCodeViolations: CodeViolation[] = [];
        const fileContents: Map<string, { content: string; lineCount: number }> = new Map();

        if ((enabledCodeRules.length > 0 || enabledLlmCodeRules.length > 0) && result.fileAnalyses) {
          emitAnalysisProgress(id, {
            step: 'analyzing',
            percent: 82,
            detail: 'Running code checks...',
          });

          for (const fa of result.fileAnalyses) {
            try {
              const lang = detectLanguage(fa.filePath);
              if (!lang) continue;
              const absPath = path.isAbsolute(fa.filePath) ? fa.filePath : path.join(repo.path, fa.filePath);
              const content = fs.readFileSync(absPath, 'utf-8');
              const lineCount = content.split('\n').length;
              fileContents.set(fa.filePath, { content, lineCount });

              if (enabledCodeRules.length > 0) {
                const tree = parseFile(fa.filePath, content, lang);
                const violations = checkCodeRules(tree, fa.filePath, content, enabledCodeRules);
                allCodeViolations.push(...violations);
              }
            } catch {
              // Skip files that fail to parse
            }
          }
        }

        // Carry over node positions from previous analysis (namespaced)
        const carryOver: Record<string, unknown> = {};
        if (Object.keys(prevPositionsByName).length > 0) {
          const newServicePositions: Record<string, { x: number; y: number }> = {};
          for (const [name, newId] of serviceIdMap) {
            if (prevPositionsByName[name]) {
              newServicePositions[newId] = prevPositionsByName[name];
            }
          }
          if (Object.keys(newServicePositions).length > 0) {
            carryOver.services = newServicePositions;
          }
        }
        if (prevLayerPositions) {
          // Layer positions use service group IDs which change on re-analysis;
          // remap using service name → new ID
          const newLayerPositions: Record<string, { x: number; y: number }> = {};
          const prevServices = prevAnalyses.length > 0
            ? await db.select().from(services).where(eq(services.analysisId, prevAnalyses[0].id))
            : [];
          const prevIdToName = new Map(prevServices.map((s) => [s.id, s.name]));
          for (const [key, pos] of Object.entries(prevLayerPositions)) {
            // Service group positions: old service ID → name → new service ID
            const name = prevIdToName.get(key);
            if (name) {
              const newId = serviceIdMap.get(name);
              if (newId) newLayerPositions[newId] = pos;
            } else {
              // Database or other nodes — keep as-is
              newLayerPositions[key] = pos;
            }
          }
          if (Object.keys(newLayerPositions).length > 0) {
            carryOver.layers = newLayerPositions;
          }
        }
        if (Object.keys(carryOver).length > 0) {
          await db
            .update(analyses)
            .set({ nodePositions: carryOver })
            .where(eq(analyses.id, analysis.id));
        }

        // Update repo lastAnalyzedAt
        await db
          .update(repos)
          .set({ lastAnalyzedAt: new Date(), updatedAt: new Date() })
          .where(eq(repos.id, id));

        // Generate LLM violations before completing
        try {
          let currentPercent = 85;
          emitAnalysisProgress(id, {
            step: 'analyzing',
            percent: currentPercent,
            detail: 'Running checks...',
          });

          const analysisServices = result.services.map((s) => ({
            id: serviceIdMap.get(s.name)!,
            name: s.name,
            type: s.type,
            framework: s.framework || undefined,
            fileCount: s.fileCount,
            layerSummary: s.layers,
          }));

          const analysisDeps = result.dependencies.map((d) => ({
            sourceServiceName: d.source,
            targetServiceName: d.target,
            dependencyCount: d.dependencies.length + (d.httpCalls?.length || 0),
            dependencyType: d.httpCalls && d.httpCalls.length > 0 ? 'http' : 'import',
          }));

          const violationDescriptions = (result.layerDependencies || [])
            .filter((d) => d.isViolation)
            .map((v) => `${v.sourceLayer} → ${v.targetLayer} in ${v.sourceServiceName}: ${v.violationReason || 'layer violation'}`);

          // Gather enabled LLM rules with category for violation generation (exclude code rules — handled separately)
          const enabledLlmRules = allRules
            .filter((r) => r.type === 'llm' && r.prompt && r.category !== 'code')
            .map((r) => ({ name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));

          // Build module data for violation generation
          const violationModules = result.modules?.map((m) => ({
            id: moduleIdMap.get(`${m.serviceName}::${m.name}::${m.filePath}`) || '',
            name: m.name,
            kind: m.kind,
            serviceName: m.serviceName,
            layerName: m.layerName,
            methodCount: m.methodCount,
            propertyCount: m.propertyCount,
            importCount: m.importCount,
            exportCount: m.exportCount,
            superClass: m.superClass || undefined,
            lineCount: m.lineCount || undefined,
          })).filter((m) => m.id); // exclude modules that weren't saved

          const violationMethods = result.methods?.map((m) => ({
            id: methodIdMap.get(`${m.serviceName}::${m.moduleName}::${m.name}::${m.filePath}`) || undefined,
            moduleName: m.moduleName,
            name: m.name,
            signature: m.signature,
            paramCount: m.paramCount,
            returnType: m.returnType || undefined,
            isAsync: m.isAsync,
            lineCount: m.lineCount || undefined,
            statementCount: m.statementCount || undefined,
            maxNestingDepth: m.maxNestingDepth || undefined,
          }));

          const violationModuleDeps = result.moduleLevelDependencies?.map((d) => {
            const srcName = result.modules?.find((m) => m.serviceName === d.sourceService && m.name === d.sourceModule)?.name;
            const tgtName = result.modules?.find((m) => m.serviceName === d.targetService && m.name === d.targetModule)?.name;
            return {
              sourceModule: srcName || d.sourceModule,
              targetModule: tgtName || d.targetModule,
              importedNames: d.importedNames,
            };
          });

          // Build LLM code violation batches from collected file contents
          const MAX_CHARS_PER_BATCH = 100_000;
          const HALF_BATCH = MAX_CHARS_PER_BATCH / 2;
          const llmCodeBatches: CodeViolationContext[] = [];
          const llmCodeRulesDtos = enabledLlmCodeRules.map((r) => ({
            name: r.name,
            severity: r.severity,
            prompt: r.prompt!,
          }));

          if (enabledLlmCodeRules.length > 0 && fileContents.size > 0) {
            let currentBatch: { path: string; content: string }[] = [];
            let currentChars = 0;

            for (const [filePath, { content }] of fileContents) {
              const fileChars = content.length;

              // Large files get their own batch
              if (fileChars > HALF_BATCH) {
                if (currentBatch.length > 0) {
                  llmCodeBatches.push({ files: currentBatch, llmRules: llmCodeRulesDtos });
                  currentBatch = [];
                  currentChars = 0;
                }
                llmCodeBatches.push({ files: [{ path: filePath, content }], llmRules: llmCodeRulesDtos });
                continue;
              }

              // Would exceed batch limit — flush current batch
              if (currentChars + fileChars > MAX_CHARS_PER_BATCH && currentBatch.length > 0) {
                llmCodeBatches.push({ files: currentBatch, llmRules: llmCodeRulesDtos });
                currentBatch = [];
                currentChars = 0;
              }

              currentBatch.push({ path: filePath, content });
              currentChars += fileChars;
            }

            if (currentBatch.length > 0) {
              llmCodeBatches.push({ files: currentBatch, llmRules: llmCodeRulesDtos });
            }
          }

          // Build name-to-key lookup for LLM code rules
          const llmCodeRuleNameToKey = new Map(enabledLlmCodeRules.map((r) => [r.name, r.key]));
          const validFilePaths = new Set(fileContents.keys());

          // Run arch/db/module violations AND LLM code violations in parallel
          const archViolationsPromise = generateViolations({
            architecture: result.architecture,
            services: analysisServices,
            dependencies: analysisDeps,
            violations: violationDescriptions,
            databases: result.databaseResult?.databases.map((d) => ({
              id: dbIdMap.get(d.name)!,
              name: d.name,
              type: d.type,
              driver: d.driver,
              tableCount: d.tables.length,
              connectedServices: d.connectedServices,
              tables: d.tables.map((t) => ({
                name: t.name,
                columns: t.columns.map((c) => ({
                  name: c.name,
                  type: c.type,
                  isNullable: c.isNullable,
                  isPrimaryKey: c.isPrimaryKey,
                  isForeignKey: c.isForeignKey,
                  referencesTable: c.referencesTable,
                })),
              })),
              relations: d.relations.map((r) => ({
                sourceTable: r.sourceTable,
                targetTable: r.targetTable,
                foreignKeyColumn: r.foreignKeyColumn,
              })),
            })),
            llmRules: enabledLlmRules,
            modules: violationModules,
            methods: violationMethods,
            moduleDependencies: violationModuleDeps,
            methodDependencies: (result.methodLevelDependencies || []).map((d) => ({
              callerMethod: d.callerMethod,
              callerModule: d.callerModule,
              calleeMethod: d.calleeMethod,
              calleeModule: d.calleeModule,
              callCount: d.callCount,
            })),
            moduleViolations: moduleViolations.map((v) => {
              const moduleKey = v.moduleName ? `${v.serviceName}::${v.moduleName}::${v.filePath}` : undefined;
              const methodKey = v.methodName && v.moduleName
                ? `${v.serviceName}::${v.moduleName}::${v.methodName}::${v.filePath}` : undefined;
              return {
                ...v,
                serviceId: serviceIdMap.get(v.serviceName),
                moduleId: moduleKey ? moduleIdMap.get(moduleKey) : undefined,
                methodId: methodKey ? methodIdMap.get(methodKey) : undefined,
              };
            }),
          }, (step) => {
            currentPercent += 3;
            emitAnalysisProgress(id, {
              step: 'analyzing',
              percent: currentPercent,
              detail: step,
            });
          });

          const llmCodePromise = llmCodeBatches.length > 0
            ? createLLMProvider().generateAllCodeViolations(llmCodeBatches)
            : Promise.resolve({ violations: [] });

          const [archResult, codeResult] = await Promise.all([archViolationsPromise, llmCodePromise]);

          const { violations: generatedViolations, serviceDescriptions } = archResult;

          for (const violation of generatedViolations) {
            await db.insert(violations).values({
              id: uuidv4(),
              repoId: id,
              analysisId: analysis.id,
              type: violation.type,
              title: violation.title,
              content: violation.content,
              severity: violation.severity,
              targetServiceId: violation.targetServiceId || null,
              targetDatabaseId: violation.targetDatabaseId || null,
              targetModuleId: violation.targetModuleId || null,
              targetMethodId: violation.targetMethodId || null,
              targetTable: violation.targetTable || null,
              fixPrompt: violation.fixPrompt || null,
            });
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

          // Post-process LLM code violations and append to allCodeViolations
          if (codeResult.violations.length > 0) {
            for (const v of codeResult.violations) {
              // Validate file path exists in input
              if (!validFilePaths.has(v.filePath)) continue;

              const fileInfo = fileContents.get(v.filePath)!;

              // Clamp line numbers to actual file range
              const lineStart = Math.max(1, Math.min(v.lineStart, fileInfo.lineCount));
              const lineEnd = Math.max(lineStart, Math.min(v.lineEnd, fileInfo.lineCount));

              // Extract snippet from file content
              const lines = fileInfo.content.split('\n');
              const snippet = lines.slice(lineStart - 1, lineEnd).join('\n');

              // Map rule name to rule key — LLM may return with severity prefix like "[HIGH] Name"
              const strippedName = v.ruleName.replace(/^\[(?:LOW|MEDIUM|HIGH|CRITICAL)\]\s*/i, '');
              const ruleKey = llmCodeRuleNameToKey.get(v.ruleName)
                || llmCodeRuleNameToKey.get(strippedName)
                || v.ruleName;

              allCodeViolations.push({
                ruleKey,
                filePath: v.filePath,
                lineStart,
                lineEnd,
                columnStart: 0,
                columnEnd: 0,
                severity: v.severity,
                title: v.title,
                content: v.content,
                snippet,
                fixPrompt: v.fixPrompt ?? undefined,
              });
            }
          }

          // Persist all code violations (deterministic + LLM)
          if (allCodeViolations.length > 0) {
            await persistCodeViolations(newAnalysisId, allCodeViolations);
          }

          emitViolationsReady(id, analysis.id);
        } catch (violationError) {
          console.error(
            `[Violations] Failed for repo ${id}:`,
            violationError instanceof Error ? violationError.message : String(violationError)
          );
          // Still persist deterministic code violations if LLM failed
          if (allCodeViolations.length > 0) {
            try {
              await persistCodeViolations(newAnalysisId, allCodeViolations);
            } catch { /* ignore */ }
          }
        }

        emitAnalysisComplete(id, analysis.id);
      } catch (error) {
        console.error(
          `[Analysis] Failed for repo ${id}:`,
          error instanceof Error ? error.message : String(error)
        );
        emitAnalysisProgress(id, {
          step: 'error',
          percent: -1,
          detail: error instanceof Error ? error.message : 'Analysis failed',
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/analyses - List past analyses
router.get(
  '/:id/analyses',
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

      const analysisList = await db
        .select({
          id: analyses.id,
          branch: analyses.branch,
          architecture: analyses.architecture,
          createdAt: analyses.createdAt,
        })
        .from(analyses)
        .where(and(eq(analyses.repoId, id), notDiffAnalysis))
        .orderBy(desc(analyses.createdAt))
        .limit(20);

      res.json(analysisList);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/graph - Get graph data
router.get(
  '/:id/graph',
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

      // If analysisId is provided, load that specific analysis (verify it belongs to repo)
      const analysisId = req.query.analysisId as string | undefined;
      let analysis;

      if (analysisId) {
        const [specific] = await db
          .select()
          .from(analyses)
          .where(and(eq(analyses.id, analysisId), eq(analyses.repoId, id)))
          .limit(1);
        if (!specific) {
          res.json({ nodes: [], edges: [] });
          return;
        }
        analysis = specific;
      } else {
        // Find the latest non-diff analysis for the branch
        const conditions = [eq(analyses.repoId, id), notDiffAnalysis];
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
          res.json({ nodes: [], edges: [] });
          return;
        }
        analysis = latestAnalysis[0];
      }

      const level = (req.query.level as string) || 'services';
      const graphLevel = level.replace(/s$/, '') as GraphLevel;

      // Fetch all data in parallel
      const [
        analysisServices,
        analysisDeps,
        analysisDatabases,
        analysisDbConnections,
        analysisLayers,
        analysisLayerDeps,
        analysisModules,
        analysisModuleDeps,
        analysisMethods,
        analysisMethodDeps,
      ] = await Promise.all([
        db.select().from(services).where(eq(services.analysisId, analysis.id)),
        db.select().from(serviceDependencies).where(eq(serviceDependencies.analysisId, analysis.id)),
        db.select().from(databases).where(eq(databases.analysisId, analysis.id)),
        db.select().from(databaseConnections).where(eq(databaseConnections.analysisId, analysis.id)),
        db.select().from(layers).where(eq(layers.analysisId, analysis.id)),
        db.select().from(layerDependencies).where(eq(layerDependencies.analysisId, analysis.id)),
        db.select().from(modules).where(eq(modules.analysisId, analysis.id)),
        db.select().from(moduleDeps).where(eq(moduleDeps.analysisId, analysis.id)),
        db.select().from(methods).where(eq(methods.analysisId, analysis.id)),
        db.select().from(methodDeps).where(eq(methodDeps.analysisId, analysis.id)),
      ]);

      const layerData = analysisLayers.map((l) => ({
        id: l.id,
        serviceName: l.serviceName,
        serviceId: l.serviceId,
        layer: l.layer,
        fileCount: l.fileCount,
        filePaths: l.filePaths as string[],
        confidence: l.confidence,
        evidence: l.evidence as string[],
      }));

      const graphData = buildUnifiedGraph(graphLevel, {
        services: analysisServices,
        serviceDeps: analysisDeps,
        layers: layerData,
        layerDeps: analysisLayerDeps,
        modules: analysisModules,
        moduleDeps: analysisModuleDeps,
        methods: analysisMethods,
        methodDeps: analysisMethodDeps,
        databases: analysisDatabases,
        dbConnections: analysisDbConnections,
      });

      // Include saved node positions if any (namespaced by level)
      const allPositions = analysis.nodePositions as Record<string, unknown> | null;
      const savedPositions = allPositions?.[level] as Record<string, { x: number; y: number }> | undefined;
      if (savedPositions) {
        for (const node of graphData.nodes) {
          const pos = savedPositions[node.id];
          if (pos) {
            node.position = pos;
          }
        }
      }

      // Include collapsed IDs for this level
      const collapsed = (allPositions?.collapsedIds as Record<string, string[]>) || {};
      const collapsedIds = collapsed[level] || [];

      res.set('Cache-Control', 'no-store');
      res.json({ ...graphData, collapsedIds });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/repos/:id/graph/positions - Save node positions
router.put(
  '/:id/graph/positions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      const level = (req.query.level as string) || 'services';
      const { positions } = req.body as { positions: Record<string, { x: number; y: number }> };

      if (!positions || typeof positions !== 'object') {
        throw createAppError('Invalid positions data', 400);
      }

      const conditions = [eq(analyses.repoId, id), notDiffAnalysis];
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
        throw createAppError('No analysis found', 404);
      }

      const existing = (latestAnalysis[0].nodePositions as Record<string, unknown>) || {};
      const merged = { ...existing, [level]: positions };

      await db
        .update(analyses)
        .set({ nodePositions: merged })
        .where(eq(analyses.id, latestAnalysis[0].id));

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/repos/:id/graph/positions - Reset to auto layout
router.delete(
  '/:id/graph/positions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      const level = (req.query.level as string) || 'services';

      const conditions = [eq(analyses.repoId, id), notDiffAnalysis];
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
        throw createAppError('No analysis found', 404);
      }

      const existing = (latestAnalysis[0].nodePositions as Record<string, unknown>) || {};
      delete existing[level];
      const merged = Object.keys(existing).length > 0 ? existing : null;

      await db
        .update(analyses)
        .set({ nodePositions: merged })
        .where(eq(analyses.id, latestAnalysis[0].id));

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/repos/:id/graph/collapsed - Save collapsed node IDs for a mode
router.put(
  '/:id/graph/collapsed',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const branch = req.query.branch as string | undefined;
      const level = (req.query.level as string) || 'modules';
      const { collapsedIds: ids } = req.body as { collapsedIds: string[] };

      if (!Array.isArray(ids)) {
        throw createAppError('Invalid collapsedIds data', 400);
      }

      const conditions = [eq(analyses.repoId, id), notDiffAnalysis];
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
        throw createAppError('No analysis found', 404);
      }

      const existing = (latestAnalysis[0].nodePositions as Record<string, unknown>) || {};
      const existingCollapsed = (existing.collapsedIds as Record<string, string[]>) || {};
      const merged = { ...existing, collapsedIds: { ...existingCollapsed, [level]: ids } };

      await db
        .update(analyses)
        .set({ nodePositions: merged })
        .where(eq(analyses.id, latestAnalysis[0].id));

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/files - File tree from the actual repository
router.get(
  '/:id/files',
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

      const git = simpleGit(repo.path);
      // Use git ls-files to get tracked files (respects .gitignore)
      const result = await git.raw(['ls-files']);
      const files = result.split('\n').filter((f) => f.length > 0);

      res.json({ root: repo.path, files });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/changes - Pending git changes
router.get(
  '/:id/changes',
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

      const git = simpleGit(repo.path);
      const statusResult = await git.status();

      const changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }> = [];

      for (const f of statusResult.not_added) {
        changedFiles.push({ path: f, status: 'new' });
      }
      for (const f of statusResult.created) {
        changedFiles.push({ path: f, status: 'new' });
      }
      for (const f of statusResult.modified) {
        changedFiles.push({ path: f, status: 'modified' });
      }
      for (const f of statusResult.staged) {
        // staged files not already captured
        if (!changedFiles.some((cf) => cf.path === f)) {
          changedFiles.push({ path: f, status: 'modified' });
        }
      }
      for (const f of statusResult.deleted) {
        changedFiles.push({ path: f, status: 'deleted' });
      }

      // Find latest normal analysis and its services to match affected services
      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(and(eq(analyses.repoId, id), notDiffAnalysis))
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      const affectedServices: string[] = [];

      if (latestAnalysis.length > 0) {
        const analysisServices = await db
          .select()
          .from(services)
          .where(eq(services.analysisId, latestAnalysis[0].id));

        for (const svc of analysisServices) {
          const svcRoot = svc.rootPath;
          const isAffected = changedFiles.some(
            (cf) => cf.path.startsWith(svcRoot + '/') || cf.path === svcRoot
          );
          if (isAffected) {
            affectedServices.push(svc.id);
          }
        }
      }

      res.json({ changedFiles, affectedServices });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/repos/:id/diff-check - Run diff analysis with LLM diffing
router.post(
  '/:id/diff-check',
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

      // Find latest normal analysis (exclude diff analyses)
      const [latestAnalysis] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(and(eq(analyses.repoId, id), notDiffAnalysis))
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      if (!latestAnalysis) {
        res.status(409).json({ error: 'Switch to Normal mode and run an analysis first' });
        return;
      }

      // Load existing violations for this analysis as baseline
      const baselineViolationRows = await db
        .select()
        .from(violations)
        .where(eq(violations.analysisId, latestAnalysis.id));

      // Resolve service/module/method names for violations
      const analysisServices = await db.select().from(services).where(eq(services.analysisId, latestAnalysis.id));
      const analysisModules = await db.select().from(modules).where(eq(modules.analysisId, latestAnalysis.id));
      const analysisMethods = await db.select().from(methods).where(eq(methods.analysisId, latestAnalysis.id));

      // Load baseline layer violations for diff comparison
      const baselineLayerViolations = await db
        .select()
        .from(layerDependencies)
        .where(eq(layerDependencies.analysisId, latestAnalysis.id));

      const baselineLayerViolationDescriptions = baselineLayerViolations
        .filter((d) => d.isViolation)
        .map((v) => `${v.sourceLayer} → ${v.targetLayer} in ${v.sourceServiceName}: ${v.violationReason || 'layer violation'}`);

      // Load baseline code violations for diff comparison
      const baselineCodeViolationRows = await db
        .select()
        .from(codeViolations)
        .where(eq(codeViolations.analysisId, latestAnalysis.id));

      const serviceNameMap = new Map(analysisServices.map((s) => [s.id, s.name]));
      const moduleNameMap = new Map(analysisModules.map((m) => [m.id, m.name]));
      const methodNameMap = new Map(analysisMethods.map((m) => [m.id, m.name]));

      const violationsWithNames = baselineViolationRows.map((i) => ({
        id: i.id,
        type: i.type,
        title: i.title,
        content: i.content,
        severity: i.severity,
        targetServiceId: i.targetServiceId ?? undefined,
        targetServiceName: i.targetServiceId ? serviceNameMap.get(i.targetServiceId) : undefined,
        targetModuleId: i.targetModuleId ?? undefined,
        targetModuleName: i.targetModuleId ? moduleNameMap.get(i.targetModuleId) : undefined,
        targetMethodId: i.targetMethodId ?? undefined,
        targetMethodName: i.targetMethodId ? methodNameMap.get(i.targetMethodId) : undefined,
        fixPrompt: i.fixPrompt ?? undefined,
        createdAt: i.createdAt.toISOString(),
      }));

      const git = simpleGit(repo.path);
      const branch = (await git.branch()).current || undefined;

      // Phase 1: Run analysis + get changed files (no LLM yet)
      const diffAnalysis = await runDiffAnalysis({
        repoPath: repo.path,
        branch,
        onProgress: (progress) => {
          emitAnalysisProgress(id, progress);
        },
      });

      // Delete old diff check and its diff analysis
      const oldDiffChecks = await db
        .select({ diffAnalysisId: diffChecks.diffAnalysisId })
        .from(diffChecks)
        .where(eq(diffChecks.repoId, id));
      for (const dc of oldDiffChecks) {
        if (dc.diffAnalysisId) {
          await db.delete(analyses).where(eq(analyses.id, dc.diffAnalysisId));
        }
      }
      await db.delete(diffChecks).where(eq(diffChecks.repoId, id));

      // Persist the diff analysis first — get real DB IDs
      const { analysisId: diffAnalysisId, serviceIdMap: diffServiceIdMap, moduleIdMap: diffModuleIdMap, methodIdMap: diffMethodIdMap } =
        await persistAnalysisResult({
          repoId: id,
          branch: branch || null,
          result: diffAnalysis.analysisResult,
          metadata: { isDiffAnalysis: true },
        });

      // Phase 2: Run LLM violation check with real DB IDs
      const result = await runDiffViolationCheck({
        repoPath: repo.path,
        analysisResult: diffAnalysis.analysisResult,
        changedFiles: diffAnalysis.changedFiles,
        baselineViolations: violationsWithNames,
        baselineLayerViolations: baselineLayerViolationDescriptions,
        baselineCodeViolations: baselineCodeViolationRows.map((r) => ({
          id: r.id,
          filePath: r.filePath,
          lineStart: r.lineStart,
          lineEnd: r.lineEnd,
          ruleKey: r.ruleKey,
          severity: r.severity,
          title: r.title,
          content: r.content,
        })),
        serviceIdMap: diffServiceIdMap,
        moduleIdMap: diffModuleIdMap,
        methodIdMap: diffMethodIdMap,
        onProgress: (progress) => {
          emitAnalysisProgress(id, progress);
        },
      });

      // Insert new diff_check with diffAnalysisId
      await db.insert(diffChecks).values({
        repoId: id,
        analysisId: latestAnalysis.id,
        diffAnalysisId,
        changedFiles: result.changedFiles,
        resolvedViolationIds: result.resolvedViolationIds,
        newViolations: result.newViolations,
        affectedNodeIds: result.affectedNodeIds,
        summary: result.summary,
      });

      // Persist code violations for the diff analysis
      if (result.codeViolations.length > 0) {
        await persistCodeViolations(diffAnalysisId, result.codeViolations);
      }

      // Build resolved violations for the response
      const resolvedSet = new Set(result.resolvedViolationIds);
      const resolvedViolations = violationsWithNames
        .filter((i) => resolvedSet.has(i.id))
        .map((i) => ({
          ...i,
          targetDatabaseId: null,
          targetDatabaseName: null,
          targetTable: null,
        }));

      // Convert code violations to diff violation items
      const codeViolationItems = result.codeViolations.map((cv) => ({
        type: 'code' as const,
        title: cv.title,
        content: cv.content,
        severity: cv.severity,
        targetServiceId: null,
        targetModuleId: null,
        targetMethodId: null,
        targetServiceName: null,
        targetModuleName: null,
        targetMethodName: null,
        fixPrompt: cv.fixPrompt || null,
        filePath: cv.filePath,
        lineStart: cv.lineStart,
      }));

      const allNewViolations = [...result.newViolations, ...codeViolationItems];

      // Clear progress bar
      emitAnalysisProgress(id, { step: 'complete', percent: 100, detail: 'Diff check complete' });

      res.json({
        changedFiles: result.changedFiles,
        resolvedViolations,
        newViolations: allNewViolations,
        affectedNodeIds: result.affectedNodeIds,
        summary: { ...result.summary, newCount: allNewViolations.length },
        isStale: false,
        diffAnalysisId,
      });
    } catch (error) {
      const repoId = req.params.id as string;
      emitAnalysisProgress(repoId, { step: 'error', percent: -1, detail: error instanceof Error ? error.message : 'Diff check failed' });
      next(error);
    }
  }
);

// GET /api/repos/:id/diff-check - Load saved diff check from DB
router.get(
  '/:id/diff-check',
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

      // Load latest diff_check for this repo
      const [diffCheck] = await db
        .select()
        .from(diffChecks)
        .where(eq(diffChecks.repoId, id))
        .orderBy(desc(diffChecks.createdAt))
        .limit(1);

      if (!diffCheck) {
        res.json(null);
        return;
      }

      // Check staleness: compare diffCheck.analysisId vs latest normal analysis
      const [latestAnalysis] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(and(eq(analyses.repoId, id), notDiffAnalysis))
        .orderBy(desc(analyses.createdAt))
        .limit(1);

      const isStale = latestAnalysis ? diffCheck.analysisId !== latestAnalysis.id : false;

      // Load resolved violations from DB for full ViolationResponse objects
      const resolvedIds = diffCheck.resolvedViolationIds as string[];
      let resolvedViolations: Array<Record<string, unknown>> = [];
      if (resolvedIds.length > 0) {
        const allViolationRows = await db
          .select()
          .from(violations)
          .where(eq(violations.analysisId, diffCheck.analysisId));

        const resolvedSet = new Set(resolvedIds);
        const analysisServices2 = await db.select().from(services).where(eq(services.analysisId, diffCheck.analysisId));
        const analysisModules2 = await db.select().from(modules).where(eq(modules.analysisId, diffCheck.analysisId));
        const analysisMethods2 = await db.select().from(methods).where(eq(methods.analysisId, diffCheck.analysisId));
        const svcMap = new Map(analysisServices2.map((s) => [s.id, s.name]));
        const modMap = new Map(analysisModules2.map((m) => [m.id, m.name]));
        const methMap = new Map(analysisMethods2.map((m) => [m.id, m.name]));

        resolvedViolations = allViolationRows
          .filter((i) => resolvedSet.has(i.id))
          .map((i) => ({
            id: i.id,
            type: i.type,
            title: i.title,
            content: i.content,
            severity: i.severity,
            targetServiceId: i.targetServiceId,
            targetServiceName: i.targetServiceId ? svcMap.get(i.targetServiceId) : null,
            targetModuleId: i.targetModuleId,
            targetModuleName: i.targetModuleId ? modMap.get(i.targetModuleId) : null,
            targetMethodId: i.targetMethodId,
            targetMethodName: i.targetMethodId ? methMap.get(i.targetMethodId) : null,
            targetDatabaseId: i.targetDatabaseId,
            targetTable: i.targetTable,
            fixPrompt: i.fixPrompt,
            createdAt: i.createdAt.toISOString(),
          }));
      }

      res.json({
        resolvedViolations,
        newViolations: diffCheck.newViolations,
        affectedNodeIds: diffCheck.affectedNodeIds,
        summary: diffCheck.summary,
        changedFiles: diffCheck.changedFiles,
        isStale,
        diffAnalysisId: diffCheck.diffAnalysisId,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/repos/:id/file-content - Read a file from the repository
router.get(
  '/:id/file-content',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const filePath = req.query.path as string;

      if (!filePath) {
        throw createAppError('Missing "path" query parameter', 400);
      }

      const [repo] = await db
        .select()
        .from(repos)
        .where(eq(repos.id, id))
        .limit(1);

      if (!repo) {
        throw createAppError('Repo not found', 404);
      }

      // Resolve and validate path is within repo
      const resolved = path.resolve(repo.path, filePath);
      if (!resolved.startsWith(path.resolve(repo.path) + path.sep) && resolved !== path.resolve(repo.path)) {
        throw createAppError('Path traversal not allowed', 403);
      }

      if (!fs.existsSync(resolved)) {
        throw createAppError('File not found', 404);
      }

      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        throw createAppError('Path is not a file', 400);
      }

      const content = fs.readFileSync(resolved, 'utf-8');

      // Detect language from extension
      const ext = path.extname(resolved).slice(1).toLowerCase();
      const langMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        json: 'json', md: 'markdown', css: 'css', html: 'html', yaml: 'yaml',
        yml: 'yaml', sql: 'sql', sh: 'shell', py: 'python', go: 'go',
        rs: 'rust', java: 'java', rb: 'ruby', php: 'php', c: 'c',
        cpp: 'cpp', h: 'c', hpp: 'cpp',
      };
      const language = langMap[ext] || 'text';

      res.json({ content, language });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
