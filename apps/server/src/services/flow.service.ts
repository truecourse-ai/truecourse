import { eq, inArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import { flows, flowSteps, violations, methods as methodsTable, modules as modulesTable } from '../db/schema.js';
import { traceFlows, normalizeUrl, AnalysisGraph, type CrossServiceCall, type RouteHandler } from '@truecourse/analyzer';
import type { AnalysisResult } from './analyzer.service.js';
import type { FileAnalysis, SupportedLanguage } from '@truecourse/shared';

export async function detectAndPersistFlows(
  analysisId: string,
  result: AnalysisResult,
): Promise<{ flowCount: number }> {
  // Build a name→type map from detected databases
  const dbTypeMap = new Map<string, string>();
  for (const db of result.databaseResult.databases) {
    dbTypeMap.set(db.name, db.type);
  }

  // Build function line-range lookup: filePath → [{ name, startLine, endLine }]
  const functionsByFile = new Map<string, { name: string; startLine: number; endLine: number }[]>();
  if (result.fileAnalyses) {
    for (const fa of result.fileAnalyses) {
      const entries: { name: string; startLine: number; endLine: number }[] = [];
      for (const fn of fa.functions) {
        entries.push({ name: fn.name, startLine: fn.location.startLine, endLine: fn.location.endLine });
      }
      for (const cls of fa.classes) {
        for (const method of cls.methods) {
          entries.push({ name: method.name, startLine: method.location.startLine, endLine: method.location.endLine });
        }
      }
      if (entries.length > 0) functionsByFile.set(fa.filePath, entries);
    }
  }

  // Build cross-service HTTP calls from service dependencies
  // ServiceDependencyInfo already has httpCalls matched to target services
  const crossServiceCalls: CrossServiceCall[] = [];
  const fileToModule = new Map<string, string>();
  for (const mod of result.modules) {
    fileToModule.set(mod.filePath, `${mod.serviceName}::${mod.name}`);
  }

  // Map filePath → language for URL normalization
  const fileToLanguage = new Map<string, SupportedLanguage>();
  if (result.fileAnalyses) {
    for (const fa of result.fileAnalyses) {
      fileToLanguage.set(fa.filePath, fa.language);
    }
  }

  for (const dep of result.dependencies) {
    if (!dep.httpCalls || dep.httpCalls.length === 0) continue;
    for (const call of dep.httpCalls) {
      const moduleKey = fileToModule.get(call.location.filePath);
      if (!moduleKey) continue;
      const [sourceService, sourceModule] = moduleKey.split('::');

      // Resolve sourceMethod from line numbers
      let sourceMethod: string | undefined;
      const fileFunctions = functionsByFile.get(call.location.filePath);
      if (fileFunctions) {
        for (const fn of fileFunctions) {
          if (call.location.startLine >= fn.startLine && call.location.startLine <= fn.endLine) {
            sourceMethod = fn.name;
            break;
          }
        }
      }

      // Normalize URL using language-aware config so the flow-tracer
      // receives language-agnostic route patterns (e.g., /users/:param)
      const language = fileToLanguage.get(call.location.filePath);
      const normalizedUrl = language ? normalizeUrl(call.url, language) : call.url;

      crossServiceCalls.push({
        sourceService,
        sourceModule,
        sourceMethod,
        httpMethod: call.method,
        url: normalizedUrl,
        targetService: dep.target,
      });
    }
  }

  // Build route handler lookup from file analyses
  const routeHandlers = buildRouteHandlerLookup(result);

  const graph = new AnalysisGraph({
    methods: result.methods,
    methodDependencies: result.methodLevelDependencies,
    modules: result.modules,
    services: result.services.map((s) => ({ name: s.name, type: s.type })),
    crossServiceCalls: crossServiceCalls.length > 0 ? crossServiceCalls : undefined,
    databaseConnections: result.databaseResult.connections.map((c) => ({
      serviceName: c.serviceName,
      databaseName: c.databaseName,
      databaseType: dbTypeMap.get(c.databaseName) || 'unknown',
    })),
    routeHandlers: routeHandlers.size > 0 ? routeHandlers : undefined,
  });

  const traced = traceFlows(graph);

  if (traced.length === 0) return { flowCount: 0 };

  // Insert flows and steps
  for (const flow of traced) {
    const [inserted] = await db
      .insert(flows)
      .values({
        analysisId,
        name: flow.name,
        entryService: flow.entryService,
        entryMethod: flow.entryMethod,
        category: flow.category,
        trigger: flow.trigger,
        stepCount: flow.steps.length,
      })
      .returning();

    if (flow.steps.length > 0) {
      await db.insert(flowSteps).values(
        flow.steps.map((step) => ({
          flowId: inserted.id,
          stepOrder: step.stepOrder,
          sourceService: step.sourceService,
          sourceModule: step.sourceModule,
          sourceMethod: step.sourceMethod,
          targetService: step.targetService,
          targetModule: step.targetModule,
          targetMethod: step.targetMethod,
          stepType: step.stepType,
          isAsync: step.isAsync,
          isConditional: step.isConditional,
        })),
      );
    }
  }

  console.error(`[Flows] Detected and persisted ${traced.length} flows for analysis ${analysisId}`);
  return { flowCount: traced.length };
}

/**
 * Build a lookup map: `${serviceName}::${httpMethod}::${fullPath}` → RouteHandler
 * Composes mount prefixes with route paths.
 */
function buildRouteHandlerLookup(result: AnalysisResult): Map<string, RouteHandler> {
  const handlers = new Map<string, RouteHandler>();
  if (!result.fileAnalyses) return handlers;

  // Map filePath → serviceName
  const fileToService = new Map<string, string>();
  // Map filePath → moduleName
  const fileToModuleName = new Map<string, string>();
  for (const mod of result.modules) {
    fileToService.set(mod.filePath, mod.serviceName);
    fileToModuleName.set(mod.filePath, mod.name);
  }

  // Collect mounts: routerName → mountPath (per service)
  // Also track which file each router variable was imported from
  const mountsByService = new Map<string, Map<string, string>>();

  for (const fa of result.fileAnalyses) {
    if (!fa.routerMounts || fa.routerMounts.length === 0) continue;
    const serviceName = fileToService.get(fa.filePath);
    if (!serviceName) continue;

    if (!mountsByService.has(serviceName)) mountsByService.set(serviceName, new Map());
    const mounts = mountsByService.get(serviceName)!;

    for (const mount of fa.routerMounts) {
      mounts.set(mount.routerName, mount.path);
    }
  }

  // Collect routes and compose full paths
  for (const fa of result.fileAnalyses) {
    if (!fa.routeRegistrations || fa.routeRegistrations.length === 0) continue;
    const serviceName = fileToService.get(fa.filePath);
    if (!serviceName) continue;

    // Find the router variable name in this file to look up its mount prefix
    const mountPrefix = findMountPrefix(fa, serviceName, mountsByService);

    for (const route of fa.routeRegistrations) {
      const fullPath = composePath(mountPrefix, route.path);

      // Resolve which module the handler belongs to
      const moduleName = resolveHandlerModule(route.handlerName, fa, result.fileAnalyses, fileToModuleName);

      const key = `${serviceName}::${route.httpMethod}::${fullPath}`;
      handlers.set(key, { handlerName: route.handlerName, moduleName });
    }
  }

  return handlers;
}

function findMountPrefix(
  fa: FileAnalysis,
  serviceName: string,
  mountsByService: Map<string, Map<string, string>>,
): string {
  const mounts = mountsByService.get(serviceName);
  if (!mounts) return '';

  // Check if any exported variable from this file matches a mounted router name
  for (const exp of fa.exports) {
    const prefix = mounts.get(exp.name);
    if (prefix) return prefix;
  }

  return '';
}

function resolveHandlerModule(
  handlerName: string,
  routeFile: FileAnalysis,
  allFiles: FileAnalysis[],
  fileToModuleName: Map<string, string>,
): string {
  // Check if handler is defined in the route file itself (classes or functions)
  for (const cls of routeFile.classes) {
    for (const method of cls.methods) {
      if (method.name === handlerName) return fileToModuleName.get(routeFile.filePath) || handlerName;
    }
  }
  for (const fn of routeFile.functions) {
    if (fn.name === handlerName) return fileToModuleName.get(routeFile.filePath) || handlerName;
  }

  // Look up imports to trace to defining file
  for (const imp of routeFile.imports) {
    const spec = imp.specifiers.find((s) => s.name === handlerName || s.alias === handlerName);
    if (spec) {
      // Find the file that defines this import
      for (const targetFile of allFiles) {
        const hasExport = targetFile.exports.some((e) => e.name === (spec.alias || spec.name) || e.name === spec.name);
        const hasFunction = targetFile.functions.some((f) => f.name === spec.name);
        const hasClassMethod = targetFile.classes.some((c) => c.methods.some((m) => m.name === spec.name));
        if (hasExport || hasFunction || hasClassMethod) {
          return fileToModuleName.get(targetFile.filePath) || handlerName;
        }
      }
    }
  }

  // Fallback: use the route file's module
  return fileToModuleName.get(routeFile.filePath) || handlerName;
}

function composePath(prefix: string, routePath: string): string {
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const r = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${p}${r}` || '/';
}

export async function getFlowsForAnalysis(analysisId: string) {
  return db
    .select()
    .from(flows)
    .where(eq(flows.analysisId, analysisId))
    .orderBy(flows.name);
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export async function getFlowSeverities(analysisId: string): Promise<Record<string, string>> {
  const allFlows = await db.select().from(flows).where(eq(flows.analysisId, analysisId));
  if (allFlows.length === 0) return {};

  const flowIds = allFlows.map((f) => f.id);
  const allSteps = await db.select().from(flowSteps).where(inArray(flowSteps.flowId, flowIds));
  const allViolations = await db.select().from(violations).where(eq(violations.analysisId, analysisId));

  // Resolve violation target IDs to names
  const methodIds = allViolations.map((v) => v.targetMethodId).filter(Boolean) as string[];
  const moduleIds = allViolations.map((v) => v.targetModuleId).filter(Boolean) as string[];

  const methodRows = methodIds.length > 0
    ? await db.select({ id: methodsTable.id, name: methodsTable.name }).from(methodsTable).where(inArray(methodsTable.id, methodIds))
    : [];
  const moduleRows = moduleIds.length > 0
    ? await db.select({ id: modulesTable.id, name: modulesTable.name }).from(modulesTable).where(inArray(modulesTable.id, moduleIds))
    : [];

  const methodIdToName = new Map(methodRows.map((m) => [m.id, m.name]));
  const moduleIdToName = new Map(moduleRows.map((m) => [m.id, m.name]));

  // Build name → highest severity maps
  const nameSev = new Map<string, string>();
  const updateSev = (key: string, sev: string) => {
    const existing = nameSev.get(key);
    if (!existing || (SEVERITY_ORDER[sev] ?? 5) < (SEVERITY_ORDER[existing] ?? 5)) {
      nameSev.set(key, sev);
    }
  };

  for (const v of allViolations) {
    if (v.targetMethodId) {
      const name = methodIdToName.get(v.targetMethodId);
      if (name) updateSev(`method:${name}`, v.severity);
    }
    if (v.targetModuleId) {
      const name = moduleIdToName.get(v.targetModuleId);
      if (name) updateSev(`module:${name}`, v.severity);
    }
  }

  // Compute per-flow highest severity
  const result: Record<string, string> = {};
  for (const flow of allFlows) {
    const steps = allSteps.filter((s) => s.flowId === flow.id);
    let highest: string | null = null;
    for (const step of steps) {
      for (const sev of [nameSev.get(`method:${step.targetMethod}`), nameSev.get(`module:${step.targetModule}`)]) {
        if (sev && (!highest || (SEVERITY_ORDER[sev] ?? 5) < (SEVERITY_ORDER[highest] ?? 5))) {
          highest = sev;
        }
      }
    }
    if (highest) result[flow.id] = highest;
  }

  return result;
}

export async function getFlowWithSteps(flowId: string) {
  const [flow] = await db
    .select()
    .from(flows)
    .where(eq(flows.id, flowId))
    .limit(1);

  if (!flow) return null;

  const steps = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.flowId, flowId))
    .orderBy(flowSteps.stepOrder);

  return { ...flow, steps };
}

export async function enrichFlowWithLLM(flowId: string): Promise<void> {
  // LLM enrichment — import provider lazily to avoid circular deps
  const { createLLMProvider } = await import('../services/llm/provider.js');
  const { getPrompt, buildFlowTemplateVars } = await import('../services/llm/prompts.js');

  const flow = await getFlowWithSteps(flowId);
  if (!flow) return;

  const provider = createLLMProvider();
  const enriched = await provider.enrichFlow({
    flowName: flow.name,
    entryService: flow.entryService,
    entryMethod: flow.entryMethod,
    trigger: flow.trigger,
    steps: flow.steps.map((s) => ({
      stepOrder: s.stepOrder,
      sourceService: s.sourceService,
      sourceModule: s.sourceModule,
      sourceMethod: s.sourceMethod,
      targetService: s.targetService,
      targetModule: s.targetModule,
      targetMethod: s.targetMethod,
      stepType: s.stepType,
      isAsync: s.isAsync,
    })),
  });

  // Update flow with enriched data
  await db
    .update(flows)
    .set({
      name: enriched.name || flow.name,
      description: enriched.description,
    })
    .where(eq(flows.id, flowId));

  // Update step descriptions
  for (const stepUpdate of enriched.stepDescriptions) {
    const step = flow.steps.find((s) => s.stepOrder === stepUpdate.stepOrder);
    if (step) {
      await db
        .update(flowSteps)
        .set({ dataDescription: stepUpdate.dataDescription })
        .where(eq(flowSteps.id, step.id));
    }
  }
}
