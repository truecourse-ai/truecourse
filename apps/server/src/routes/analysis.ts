import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc, and } from 'drizzle-orm';
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
} from '../db/schema.js';
import { AnalyzeRepoSchema } from '@truecourse/shared';
import { createAppError } from '../middleware/error.js';
import { simpleGit } from 'simple-git';
import { runAnalysis, runDeterministicModuleChecks } from '../services/analyzer.service.js';
import { runDiffCheck } from '../services/diff-check.service.js';
import {
  emitAnalysisProgress,
  emitAnalysisComplete,
  emitViolationsReady,
} from '../socket/handlers.js';
import { buildGraphData, buildModuleGraphData, buildMethodGraphData } from '../services/graph.service.js';
import { generateViolations } from '../services/violation.service.js';
import type { ModuleViolation } from '@truecourse/analyzer';
import { getEnabledRules } from '../services/rules.service.js';
import { v4 as uuidv4 } from 'uuid';

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
        const prevConditions = [eq(analyses.repoId, id)];
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

        // Save analysis to database
        const [analysis] = await db
          .insert(analyses)
          .values({
            repoId: id,
            branch: branch || null,
            architecture: result.architecture,
            metadata: result.metadata,
          })
          .returning();

        // Save services
        const serviceIdMap = new Map<string, string>();

        for (const svc of result.services) {
          const [savedService] = await db
            .insert(services)
            .values({
              analysisId: analysis.id,
              name: svc.name,
              rootPath: svc.rootPath,
              type: svc.type,
              framework: svc.framework || null,
              fileCount: svc.fileCount,
              layerSummary: svc.layers,
            })
            .returning();

          serviceIdMap.set(svc.name, savedService.id);
        }

        // Save service dependencies
        for (const dep of result.dependencies) {
          const sourceId = serviceIdMap.get(dep.source);
          const targetId = serviceIdMap.get(dep.target);

          if (sourceId && targetId) {
            const depType = dep.httpCalls && dep.httpCalls.length > 0 ? 'http' : 'import';
            const depCount = dep.dependencies.length + (dep.httpCalls?.length || 0);

            await db.insert(serviceDependencies).values({
              analysisId: analysis.id,
              sourceServiceId: sourceId,
              targetServiceId: targetId,
              dependencyCount: depCount,
              dependencyType: depType,
            });
          }
        }

        // Save layer details
        if (result.layerDetails) {
          for (const detail of result.layerDetails) {
            const serviceId = serviceIdMap.get(detail.serviceName);
            if (serviceId) {
              await db.insert(layers).values({
                analysisId: analysis.id,
                serviceId,
                serviceName: detail.serviceName,
                layer: detail.layer,
                fileCount: detail.fileCount,
                filePaths: detail.filePaths,
                confidence: Math.round(detail.confidence * 100),
                evidence: detail.evidence,
              });
            }
          }
        }

        // Save layer dependencies
        if (result.layerDependencies) {
          for (const dep of result.layerDependencies) {
            await db.insert(layerDependencies).values({
              analysisId: analysis.id,
              sourceServiceName: dep.sourceServiceName,
              sourceLayer: dep.sourceLayer,
              targetServiceName: dep.targetServiceName,
              targetLayer: dep.targetLayer,
              dependencyCount: dep.dependencyCount,
              isViolation: dep.isViolation,
              violationReason: dep.violationReason || null,
            });
          }

        }

        // Save detected databases
        const dbIdMap = new Map<string, string>();
        if (result.databaseResult && result.databaseResult.databases.length > 0) {

          for (const dbInfo of result.databaseResult.databases) {
            const [savedDb] = await db.insert(databases).values({
              analysisId: analysis.id,
              name: dbInfo.name,
              type: dbInfo.type,
              driver: dbInfo.driver,
              connectionConfig: dbInfo.connectionEnvVar ? { envVar: dbInfo.connectionEnvVar } : null,
              tables: dbInfo.tables,
              dbRelations: dbInfo.relations,
              connectedServices: dbInfo.connectedServices,
            }).returning();

            dbIdMap.set(dbInfo.name, savedDb.id);
          }

          for (const conn of result.databaseResult.connections) {
            const serviceId = serviceIdMap.get(conn.serviceName);
            const databaseId = dbIdMap.get(conn.databaseName);
            if (serviceId && databaseId) {
              await db.insert(databaseConnections).values({
                analysisId: analysis.id,
                serviceId,
                databaseId,
                driver: conn.driver,
              });
            }
          }
        }

        // Save modules
        // Key includes filePath to avoid collisions when multiple files produce
        // modules with the same name (e.g. Next.js route.ts files).
        const moduleIdMap = new Map<string, string>(); // "serviceName::moduleName::filePath" → dbId
        if (result.modules && result.modules.length > 0) {
          // Build layer lookup: "serviceName::layerName" → layerId
          const layerIdLookup = new Map<string, string>();
          const savedLayers = await db
            .select()
            .from(layers)
            .where(eq(layers.analysisId, analysis.id));
          for (const l of savedLayers) {
            layerIdLookup.set(`${l.serviceName}::${l.layer}`, l.id);
          }

          for (const mod of result.modules) {
            const serviceId = serviceIdMap.get(mod.serviceName);
            const layerId = layerIdLookup.get(`${mod.serviceName}::${mod.layerName}`);
            if (!serviceId || !layerId) continue;

            const [saved] = await db.insert(modules).values({
              analysisId: analysis.id,
              layerId,
              serviceId,
              name: mod.name,
              kind: mod.kind,
              filePath: mod.filePath,
              methodCount: mod.methodCount,
              propertyCount: mod.propertyCount,
              importCount: mod.importCount,
              exportCount: mod.exportCount,
              superClass: mod.superClass || null,
              lineCount: mod.lineCount || null,
            }).returning();

            moduleIdMap.set(`${mod.serviceName}::${mod.name}::${mod.filePath}`, saved.id);
          }
        }

        // Save methods (and build methodIdMap for method deps)
        const methodIdMap = new Map<string, string>();
        if (result.methods && result.methods.length > 0) {
          for (const method of result.methods) {
            const moduleKey = `${method.serviceName}::${method.moduleName}::${method.filePath}`;
            const moduleId = moduleIdMap.get(moduleKey);
            if (!moduleId) continue;

            const [saved] = await db.insert(methods).values({
              analysisId: analysis.id,
              moduleId,
              name: method.name,
              signature: method.signature,
              paramCount: method.paramCount,
              returnType: method.returnType || null,
              isAsync: method.isAsync,
              isExported: method.isExported,
              lineCount: method.lineCount || null,
              statementCount: method.statementCount || null,
              maxNestingDepth: method.maxNestingDepth || null,
            }).returning();

            methodIdMap.set(`${method.serviceName}::${method.moduleName}::${method.name}::${method.filePath}`, saved.id);
          }
        }

        // Save module dependencies
        console.log(`[Analysis] File dependencies: ${result.dependencies.length}, Module-level deps: ${result.moduleLevelDependencies?.length ?? 0}, Modules: ${result.modules?.length ?? 0}`);
        if (result.moduleLevelDependencies && result.moduleLevelDependencies.length > 0) {
          for (const dep of result.moduleLevelDependencies) {
            const srcId = moduleIdMap.get(`${dep.sourceService}::${dep.sourceModule}::${dep.sourceFilePath || ''}`);
            const tgtId = moduleIdMap.get(`${dep.targetService}::${dep.targetModule}::${dep.targetFilePath || ''}`);
            if (!srcId || !tgtId) {
              console.log(`[Analysis] Skipped module dep: ${dep.sourceService}::${dep.sourceModule} → ${dep.targetService}::${dep.targetModule} (srcId=${!!srcId}, tgtId=${!!tgtId})`);
              continue;
            }

            await db.insert(moduleDeps).values({
              analysisId: analysis.id,
              sourceModuleId: srcId,
              targetModuleId: tgtId,
              importedNames: dep.importedNames,
              dependencyCount: dep.importedNames.length || 1,
            });
          }
        }

        // Save method dependencies
        if (result.methodLevelDependencies && result.methodLevelDependencies.length > 0) {
          for (const dep of result.methodLevelDependencies) {
            const srcId = methodIdMap.get(`${dep.callerService}::${dep.callerModule}::${dep.callerMethod}::${dep.callerFilePath || ''}`);
            const tgtId = methodIdMap.get(`${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}::${dep.calleeFilePath || ''}`);
            if (!srcId || !tgtId) continue;

            await db.insert(methodDeps).values({
              analysisId: analysis.id,
              sourceMethodId: srcId,
              targetMethodId: tgtId,
              callCount: dep.callCount,
            });
          }
        }

        // Load rules from database
        const allRules = await getEnabledRules();

        // Check deterministic module rules
        const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic');
        const moduleViolations: ModuleViolation[] = runDeterministicModuleChecks(result, enabledDeterministic);

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
          const callParts: string[] = ['architecture'];
          if (result.databaseResult && result.databaseResult.databases.length > 0) callParts.push('database');
          if (result.modules && result.modules.length > 0) callParts.push('module');

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

          // Gather enabled LLM rules with category for violation generation
          const enabledLlmRules = allRules
            .filter((r) => r.type === 'llm' && r.prompt)
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

          const { violations: generatedViolations, serviceDescriptions } = await generateViolations({
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

          emitViolationsReady(id, analysis.id);
        } catch (violationError) {
          console.error(
            `[Violations] Failed for repo ${id}:`,
            violationError instanceof Error ? violationError.message : String(violationError)
          );
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
        .where(eq(analyses.repoId, id))
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
        // Find the latest analysis for the branch
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
          res.json({ nodes: [], edges: [] });
          return;
        }
        analysis = latestAnalysis[0];
      }

      const level = (req.query.level as string) || 'services';

      const analysisServices = await db
        .select()
        .from(services)
        .where(eq(services.analysisId, analysis.id));

      const analysisDeps = await db
        .select()
        .from(serviceDependencies)
        .where(eq(serviceDependencies.analysisId, analysis.id));

      // Fetch databases for this analysis
      const analysisDatabases = await db
        .select()
        .from(databases)
        .where(eq(databases.analysisId, analysis.id));

      const analysisDbConnections = await db
        .select()
        .from(databaseConnections)
        .where(eq(databaseConnections.analysisId, analysis.id));

      let graphData;

      if (level === 'modules' || level === 'methods') {
        const analysisLayers = await db
          .select()
          .from(layers)
          .where(eq(layers.analysisId, analysis.id));

        const analysisLayerDeps = await db
          .select()
          .from(layerDependencies)
          .where(eq(layerDependencies.analysisId, analysis.id));

        const analysisModules = await db
          .select()
          .from(modules)
          .where(eq(modules.analysisId, analysis.id));

        const analysisModuleDeps = await db
          .select()
          .from(moduleDeps)
          .where(eq(moduleDeps.analysisId, analysis.id));

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

        if (level === 'methods') {
          const analysisMethods = await db
            .select()
            .from(methods)
            .where(eq(methods.analysisId, analysis.id));

          const analysisMethodDeps = await db
            .select()
            .from(methodDeps)
            .where(eq(methodDeps.analysisId, analysis.id));

          graphData = buildMethodGraphData(
            analysisServices,
            layerData,
            analysisModules,
            analysisMethods,
            analysisModuleDeps,
            analysisDatabases,
            analysisDbConnections,
            analysisLayerDeps,
            analysisMethodDeps,
            analysisDeps,
          );
        } else {
          graphData = buildModuleGraphData(
            analysisServices,
            layerData,
            analysisModules,
            analysisModuleDeps,
            analysisDatabases,
            analysisDbConnections,
            analysisLayerDeps,
            analysisDeps,
          );
        }
      } else {
        graphData = buildGraphData(analysisServices, analysisDeps, analysisDatabases, analysisDbConnections);
      }

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

      // Find latest analysis and its services to match affected services
      const latestAnalysis = await db
        .select()
        .from(analyses)
        .where(eq(analyses.repoId, id))
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

      // Find latest normal analysis
      const [latestAnalysis] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(eq(analyses.repoId, id))
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

      const result = await runDiffCheck({
        repoPath: repo.path,
        branch,
        baselineViolations: violationsWithNames,
        baselineLayerViolations: baselineLayerViolationDescriptions,
        onProgress: (progress) => {
          emitAnalysisProgress(id, progress);
        },
      });

      // Delete old diff_check for this repo (upsert behavior)
      await db.delete(diffChecks).where(eq(diffChecks.repoId, id));

      // Insert new diff_check
      await db.insert(diffChecks).values({
        repoId: id,
        analysisId: latestAnalysis.id,
        changedFiles: result.changedFiles,
        resolvedViolationIds: result.resolvedViolationIds,
        newViolations: result.newViolations,
        affectedNodeIds: result.affectedNodeIds,
        summary: result.summary,
      });

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

      // Clear progress bar
      emitAnalysisProgress(id, { step: 'complete', percent: 100, detail: 'Diff check complete' });

      res.json({
        changedFiles: result.changedFiles,
        resolvedViolations,
        newViolations: result.newViolations,
        affectedNodeIds: result.affectedNodeIds,
        summary: result.summary,
        isStale: false,
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
        .where(eq(analyses.repoId, id))
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
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
