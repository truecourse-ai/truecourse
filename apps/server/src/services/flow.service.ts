import { randomUUID } from 'node:crypto';
import { log } from '../lib/logger.js';
import { traceFlows, normalizeUrl, AnalysisGraph, type CrossServiceCall, type RouteHandler } from '@truecourse/analyzer';
import type { AnalysisResult } from './analyzer.service.js';
import type { FileAnalysis, SupportedLanguage } from '@truecourse/shared';
import type { FlowRecord, FlowStepRecord, LatestSnapshot } from '../types/snapshot.js';
import { readLatest, writeLatest } from '../lib/analysis-store.js';

/**
 * Trace the analyzer result into `FlowRecord[]` with steps nested. Pure —
 * consumers put the result into `AnalysisSnapshot.graph.flows` (Phase 2
 * orchestrator) or pass it through to the LATEST materialization.
 */
export function detectFlows(result: AnalysisResult): FlowRecord[] {
  const dbTypeMap = new Map<string, string>();
  for (const db of result.databaseResult.databases) {
    dbTypeMap.set(db.name, db.type);
  }

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

  const crossServiceCalls: CrossServiceCall[] = [];
  const fileToModule = new Map<string, string>();
  for (const mod of result.modules) {
    fileToModule.set(mod.filePath, `${mod.serviceName}::${mod.name}`);
  }

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

  const out: FlowRecord[] = traced.map((flow) => ({
    id: randomUUID(),
    name: flow.name,
    description: null,
    entryService: flow.entryService,
    entryMethod: flow.entryMethod,
    category: flow.category,
    trigger: flow.trigger,
    stepCount: flow.steps.length,
    steps: flow.steps.map(
      (step): FlowStepRecord => ({
        stepOrder: step.stepOrder,
        sourceService: step.sourceService,
        sourceModule: step.sourceModule,
        sourceMethod: step.sourceMethod,
        targetService: step.targetService,
        targetModule: step.targetModule,
        targetMethod: step.targetMethod,
        stepType: step.stepType,
        dataDescription: null,
        isAsync: step.isAsync,
        isConditional: step.isConditional,
      }),
    ),
  }));

  log.info(`[Flows] Detected ${out.length} flows`);
  return out;
}

// ---------------------------------------------------------------------------
// Route handler lookup (unchanged — still pure)
// ---------------------------------------------------------------------------

function buildRouteHandlerLookup(result: AnalysisResult): Map<string, RouteHandler> {
  const handlers = new Map<string, RouteHandler>();
  if (!result.fileAnalyses) return handlers;

  const fileToService = new Map<string, string>();
  const fileToModuleName = new Map<string, string>();
  for (const mod of result.modules) {
    fileToService.set(mod.filePath, mod.serviceName);
    fileToModuleName.set(mod.filePath, mod.name);
  }
  for (const ld of result.layerDetails) {
    for (const fp of ld.filePaths) {
      if (!fileToService.has(fp)) fileToService.set(fp, ld.serviceName);
    }
  }

  const fileMountPrefix = new Map<string, string>();
  for (const fa of result.fileAnalyses) {
    if (!fa.routerMounts || fa.routerMounts.length === 0) continue;
    for (const mount of fa.routerMounts) {
      for (const imp of fa.imports) {
        const spec = imp.specifiers.find((s) => s.name === mount.routerName || s.alias === mount.routerName);
        if (spec) {
          for (const dep of result.moduleDependencies) {
            if (dep.source === fa.filePath && dep.importedNames.includes(spec.name)) {
              fileMountPrefix.set(dep.target, mount.path);
            }
          }
        }
      }
      const hasLocal = fa.functions.some((f) => f.name === mount.routerName)
        || fa.exports.some((e) => e.name === mount.routerName);
      if (hasLocal) fileMountPrefix.set(fa.filePath, mount.path);
    }
  }

  for (const fa of result.fileAnalyses) {
    if (!fa.routeRegistrations || fa.routeRegistrations.length === 0) continue;
    const serviceName = fileToService.get(fa.filePath);
    if (!serviceName) continue;
    const mountPrefix = fileMountPrefix.get(fa.filePath) || '';

    for (const route of fa.routeRegistrations) {
      const fullPath = composePath(mountPrefix, route.path);
      const moduleName = resolveHandlerModule(route.handlerName, fa, result.fileAnalyses, fileToModuleName);
      const key = `${serviceName}::${route.httpMethod}::${fullPath}`;
      handlers.set(key, { handlerName: route.handlerName, moduleName });
    }
  }

  return handlers;
}

function resolveHandlerModule(
  handlerName: string,
  routeFile: FileAnalysis,
  allFiles: FileAnalysis[],
  fileToModuleName: Map<string, string>,
): string {
  for (const cls of routeFile.classes) {
    for (const method of cls.methods) {
      if (method.name === handlerName) return fileToModuleName.get(routeFile.filePath) || handlerName;
    }
  }
  for (const fn of routeFile.functions) {
    if (fn.name === handlerName) return fileToModuleName.get(routeFile.filePath) || handlerName;
  }

  for (const imp of routeFile.imports) {
    const spec = imp.specifiers.find((s) => s.name === handlerName || s.alias === handlerName);
    if (spec) {
      for (const targetFile of allFiles) {
        const hasExport = targetFile.exports.some((e) => e.name === (spec.alias || spec.name) || e.name === spec.name);
        const hasFunction = targetFile.functions.some((f) => f.name === spec.name);
        const hasClassMethod = targetFile.classes.some((c) => c.methods.some((m) => m.name === spec.name));
        if (hasExport || hasFunction || hasClassMethod) {
          return fileToModuleName.get(targetFile.filePath) || handlerName;
        }
      }
    }

    for (const s of imp.specifiers) {
      for (const targetFile of allFiles) {
        for (const cls of targetFile.classes) {
          if (cls.name === s.name && cls.methods.some((m) => m.name === handlerName)) {
            return fileToModuleName.get(targetFile.filePath) || cls.name;
          }
        }
      }
    }
  }

  return fileToModuleName.get(routeFile.filePath) || handlerName;
}

function composePath(prefix: string, routePath: string): string {
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const r = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const full = `${p}${r}`;
  return full.length > 1 && full.endsWith('/') ? full.slice(0, -1) : full || '/';
}

// ---------------------------------------------------------------------------
// Read-side helpers backed by LATEST.json (used by routes)
// ---------------------------------------------------------------------------

export function getFlowsFromLatest(repoPath: string): FlowRecord[] {
  const latest = readLatest(repoPath);
  return latest?.graph.flows ?? [];
}

export function getFlowFromLatest(repoPath: string, flowId: string): FlowRecord | null {
  const latest = readLatest(repoPath);
  return latest?.graph.flows.find((f) => f.id === flowId) ?? null;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Compute per-flow highest severity from LATEST's active violations. */
export function computeFlowSeverities(latest: LatestSnapshot): Record<string, string> {
  const nameSev = new Map<string, string>();
  const bump = (key: string, sev: string) => {
    const existing = nameSev.get(key);
    if (!existing || (SEVERITY_ORDER[sev] ?? 5) < (SEVERITY_ORDER[existing] ?? 5)) {
      nameSev.set(key, sev);
    }
  };

  const moduleIdToName = new Map(latest.graph.modules.map((m) => [m.id, m.name]));
  const methodIdToName = new Map(latest.graph.methods.map((m) => [m.id, m.name]));

  for (const v of latest.violations) {
    if (v.targetMethodId) {
      const name = methodIdToName.get(v.targetMethodId);
      if (name) bump(`method:${name}`, v.severity);
    }
    if (v.targetModuleId) {
      const name = moduleIdToName.get(v.targetModuleId);
      if (name) bump(`module:${name}`, v.severity);
    }
  }

  const out: Record<string, string> = {};
  for (const flow of latest.graph.flows) {
    let highest: string | null = null;
    for (const step of flow.steps) {
      for (const sev of [nameSev.get(`method:${step.targetMethod}`), nameSev.get(`module:${step.targetModule}`)]) {
        if (sev && (!highest || (SEVERITY_ORDER[sev] ?? 5) < (SEVERITY_ORDER[highest] ?? 5))) {
          highest = sev;
        }
      }
    }
    if (highest) out[flow.id] = highest;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Flow enrichment (LLM) — mutates LATEST.json in place
// ---------------------------------------------------------------------------

export async function enrichFlowWithLLM(repoPath: string, flowId: string): Promise<void> {
  const { createLLMProvider } = await import('./llm/provider.js');

  const latest = readLatest(repoPath);
  if (!latest) return;
  const flow = latest.graph.flows.find((f) => f.id === flowId);
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

  flow.name = enriched.name || flow.name;
  flow.description = enriched.description;
  for (const upd of enriched.stepDescriptions) {
    const step = flow.steps.find((s) => s.stepOrder === upd.stepOrder);
    if (step) step.dataDescription = upd.dataDescription;
  }

  writeLatest(repoPath, latest);
}
