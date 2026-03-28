import { describe, it, expect } from 'vitest';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildDependencyGraph } from '../../packages/analyzer/src/dependency-graph';
import { performSplitAnalysis } from '../../packages/analyzer/src/split-analyzer';
import { normalizeUrl } from '../../packages/analyzer/src/language-config';
import { AnalysisGraph } from '../../packages/analyzer/src/analysis-graph';
import { traceFlows } from '../../packages/analyzer/src/flow-tracer';
import type { FileAnalysis, SupportedLanguage } from '../../packages/shared/src/types/analysis';
import type { CrossServiceCall, RouteHandler } from '../../packages/analyzer/src/analysis-graph';

const ROOT = new URL('../fixtures/sample-python-project', import.meta.url).pathname;

/**
 * Reproduce the same flow detection logic as flow.service.ts
 * but without the database dependency.
 */
async function buildFlows() {
  const files = discoverFiles(ROOT);
  const analyses = (await Promise.all(files.map(f => analyzeFile(f)))).filter(Boolean) as FileAnalysis[];
  const deps = buildDependencyGraph(analyses, ROOT);
  const split = performSplitAnalysis(ROOT, analyses, deps);

  // Same logic as flow.service.ts
  const crossServiceCalls: CrossServiceCall[] = [];
  const fileToModule = new Map<string, string>();
  for (const mod of split.modules) {
    fileToModule.set(mod.filePath, `${mod.serviceName}::${mod.name}`);
  }

  const fileToLanguage = new Map<string, SupportedLanguage>();
  for (const fa of analyses) fileToLanguage.set(fa.filePath, fa.language);

  const functionsByFile = new Map<string, { name: string; startLine: number; endLine: number }[]>();
  for (const fa of analyses) {
    const entries: { name: string; startLine: number; endLine: number }[] = [];
    for (const fn of fa.functions) entries.push({ name: fn.name, startLine: fn.location.startLine, endLine: fn.location.endLine });
    for (const cls of fa.classes) for (const m of cls.methods) entries.push({ name: m.name, startLine: m.location.startLine, endLine: m.location.endLine });
    if (entries.length > 0) functionsByFile.set(fa.filePath, entries);
  }

  // Cross-service calls come from ServiceDependencyInfo.httpCalls
  for (const sDep of split.dependencies) {
    if (!sDep.httpCalls?.length) continue;
    for (const call of sDep.httpCalls) {
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
        targetService: sDep.target,
      });
    }
  }

  // Build route handler lookup (same as buildRouteHandlerLookup)
  const routeHandlers = new Map<string, RouteHandler>();
  const fileToService = new Map<string, string>();
  const fileToModuleName = new Map<string, string>();
  for (const mod of split.modules) {
    fileToService.set(mod.filePath, mod.serviceName);
    fileToModuleName.set(mod.filePath, mod.name);
  }
  // Files without modules (thin routers) — use layerDetails
  for (const ld of split.layerDetails) {
    for (const fp of ld.filePaths) {
      if (!fileToService.has(fp)) fileToService.set(fp, ld.serviceName);
    }
  }

  // Build mount prefix: trace from mount file through imports to route file
  const fileMountPrefix = new Map<string, string>();
  for (const fa of analyses) {
    if (!fa.routerMounts?.length) continue;
    for (const mount of fa.routerMounts) {
      for (const imp of fa.imports) {
        const spec = imp.specifiers.find(s => s.name === mount.routerName || s.alias === mount.routerName);
        if (spec) {
          for (const dep of deps) {
            if (dep.source === fa.filePath && dep.importedNames.includes(spec.name)) {
              fileMountPrefix.set(dep.target, mount.path);
            }
          }
        }
      }
    }
  }

  for (const fa of analyses) {
    if (!fa.routeRegistrations?.length) continue;
    const svc = fileToService.get(fa.filePath);
    if (!svc) continue;
    const mountPrefix = fileMountPrefix.get(fa.filePath) || '';

    for (const route of fa.routeRegistrations) {
      const p = mountPrefix.endsWith('/') ? mountPrefix.slice(0, -1) : mountPrefix;
      const r = route.path.startsWith('/') ? route.path : `/${route.path}`;
      let fullPath = `${p}${r}` || '/';
      if (fullPath.length > 1 && fullPath.endsWith('/')) fullPath = fullPath.slice(0, -1);

      // Resolve handler module
      let moduleName = fileToModuleName.get(fa.filePath) || 'unknown';
      for (const imp of fa.imports) {
        const spec = imp.specifiers.find(s => s.name === route.handlerName);
        if (spec) {
          for (const tf of analyses) {
            if (tf.functions.some(f => f.name === spec.name) || tf.exports.some(e => e.name === spec.name)) {
              moduleName = fileToModuleName.get(tf.filePath) || moduleName;
              break;
            }
          }
        }
        for (const s of imp.specifiers) {
          for (const tf of analyses) {
            for (const cls of tf.classes) {
              if (cls.name === s.name && cls.methods.some(m => m.name === route.handlerName)) {
                moduleName = fileToModuleName.get(tf.filePath) || cls.name;
              }
            }
          }
        }
      }

      const key = `${svc}::${route.httpMethod}::${fullPath}`;
      routeHandlers.set(key, { handlerName: route.handlerName, moduleName });
    }
  }

  const dbTypeMap = new Map<string, string>();
  for (const db of split.databaseResult.databases) dbTypeMap.set(db.name, db.type);

  const graph = new AnalysisGraph({
    methods: split.methods,
    methodDependencies: split.methodLevelDependencies,
    modules: split.modules,
    services: split.services.map(s => ({ name: s.name, type: s.type })),
    crossServiceCalls: crossServiceCalls.length > 0 ? crossServiceCalls : undefined,
    databaseConnections: split.databaseResult.connections.map(c => ({
      serviceName: c.serviceName,
      databaseName: c.databaseName,
      databaseType: dbTypeMap.get(c.databaseName) || 'unknown',
    })),
    routeHandlers: routeHandlers.size > 0 ? routeHandlers : undefined,
  });

  return { flows: traceFlows(graph), crossServiceCalls, routeHandlers };
}

describe('Python fixture flow tracing', () => {
  it('produces 5 flows', async () => {
    const { flows, crossServiceCalls, routeHandlers } = await buildFlows();

    console.log('\nCross-service calls:', crossServiceCalls.length);
    for (const c of crossServiceCalls) console.log(`  ${c.sourceService}/${c.sourceModule}.${c.sourceMethod} ${c.httpMethod} ${c.url} → ${c.targetService}`);

    console.log('\nRoute handlers:', routeHandlers.size);
    for (const [k, v] of routeHandlers) console.log(`  ${k} → ${v.moduleName}.${v.handlerName}`);

    console.log('\nFlows:', flows.length);
    for (const f of flows) console.log(`  ${f.name} (${f.trigger}, ${f.steps.length} steps)`);

    expect(flows.length).toBe(5);
  });
});
