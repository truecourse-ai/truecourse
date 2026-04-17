import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getGit } from '../lib/git.js';
import { log } from '../lib/logger.js';
import { readProjectConfig } from '../config/project-config.js';
import type { RegistryEntry } from '../config/registry.js';
import { runAnalysis } from '../services/analyzer.service.js';
import { buildGraph } from '../services/analysis-persistence.service.js';
import { runViolationPipeline } from '../services/violation-pipeline.service.js';
import { readLatest, writeDiff } from '../lib/analysis-store.js';
import type {
  DiffSnapshot,
  LatestSnapshot,
  ViolationRecord,
  ViolationWithNames,
} from '../types/snapshot.js';
import type { StepTracker } from '../socket/handlers.js';

/**
 * Single entry point for a diff analysis — used by:
 *   - `POST /api/repos/:id/diff-check`   (dashboard)
 *   - `truecourse analyze --diff`        (CLI)
 *
 * Reads `LATEST.json` as baseline, parses the working tree (skipStash so
 * uncommitted edits are visible), runs the violation pipeline with LATEST's
 * active set as the prior state, and writes `diff.json`. Never mutates
 * `LATEST.json` or `history.json` — the diff is ephemeral.
 */
export interface DiffInProcessOptions {
  tracker?: StepTracker;
  onProgress?: (progress: { detail?: string }) => void;
  signal?: AbortSignal;
  /** Override the per-repo config's enableLlmRules flag. */
  enableLlmRulesOverride?: boolean;
  enabledCategoriesOverride?: string[];
}

export interface DiffInProcessResult {
  diff: DiffSnapshot;
  /** True when `diff.baseAnalysisId` matches the current `LATEST`. Always true
   *  immediately after this call — included so callers don't duplicate the check. */
  isStale: boolean;
}

export async function diffInProcess(
  project: RegistryEntry,
  options: DiffInProcessOptions = {},
): Promise<DiffInProcessResult> {
  const latest = readLatest(project.path);
  if (!latest) {
    throw new Error('Run a full analysis first before checking a diff.');
  }

  const projectConfig = readProjectConfig(project.path);
  const enabledCategories =
    options.enabledCategoriesOverride ?? projectConfig.enabledCategories ?? undefined;
  const enableLlmRules =
    options.enableLlmRulesOverride ?? projectConfig.enableLlmRules ?? false;

  const git = await getGit(project.path);
  const statusResult = await git.status();
  const changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }> = [];
  for (const f of statusResult.not_added) changedFiles.push({ path: f, status: 'new' });
  for (const f of statusResult.created) changedFiles.push({ path: f, status: 'new' });
  for (const f of statusResult.modified) changedFiles.push({ path: f, status: 'modified' });
  for (const f of statusResult.staged) {
    if (!changedFiles.some((cf) => cf.path === f)) {
      changedFiles.push({ path: f, status: 'modified' });
    }
  }
  for (const f of statusResult.deleted) changedFiles.push({ path: f, status: 'deleted' });

  const commitHash = (await git.revparse(['HEAD'])).trim() || null;

  options.tracker?.start('parse', 'Analyzing working tree...');
  const result = await runAnalysis(
    project.path,
    latest.analysis.branch ?? undefined,
    (progress) => {
      options.tracker?.detail('parse', progress.detail ?? 'Analyzing...');
      options.onProgress?.({ detail: progress.detail });
    },
    { signal: options.signal, skipStash: true },
  );

  if (options.signal?.aborted) throw new DOMException('Diff cancelled', 'AbortError');

  const { graph, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap } = buildGraph(result);

  const analysisId = randomUUID();
  const now = new Date().toISOString();

  options.tracker?.done(
    'parse',
    `${result.services.length} services, ${result.fileAnalyses?.length ?? 0} files`,
  );

  const pipelineResult = await runViolationPipeline({
    repoPath: project.path,
    analysisId,
    now,
    result,
    serviceIdMap,
    moduleIdMap,
    methodIdMap,
    dbIdMap,
    previousActiveViolations: latest.violations,
    enabledCategories,
    enableLlmRules,
    tracker: options.tracker,
    signal: options.signal,
  });

  const diff = buildDiffSnapshot({
    latest,
    graph,
    analysisId,
    now,
    branch: latest.analysis.branch,
    commitHash,
    changedFiles,
    pipelineResult,
    repoPath: project.path,
  });

  writeDiff(project.path, diff);
  log.info(
    `[Diff] Done — ${diff.summary.newCount} new, ${diff.summary.unchangedCount} unchanged, ${diff.summary.resolvedCount} resolved across ${diff.changedFiles.length} changed files`,
  );

  return { diff, isStale: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDiffSnapshot(params: {
  latest: LatestSnapshot;
  graph: ReturnType<typeof buildGraph>['graph'];
  analysisId: string;
  now: string;
  branch: string | null;
  commitHash: string | null;
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  pipelineResult: Awaited<ReturnType<typeof runViolationPipeline>>;
  repoPath: string;
}): DiffSnapshot {
  const { latest, graph, analysisId, branch, commitHash, changedFiles, pipelineResult, repoPath } = params;

  const serviceById = new Map(graph.services.map((s) => [s.id, s.name]));
  const moduleById = new Map(graph.modules.map((m) => [m.id, m.name]));
  const methodById = new Map(graph.methods.map((m) => [m.id, m.name]));
  const databaseById = new Map(graph.databases.map((d) => [d.id, d.name]));

  const denormalize = (v: ViolationRecord): ViolationWithNames => ({
    ...v,
    targetServiceName: v.targetServiceId ? serviceById.get(v.targetServiceId) ?? null : null,
    targetModuleName: v.targetModuleId ? moduleById.get(v.targetModuleId) ?? null : null,
    targetMethodName: v.targetMethodId ? methodById.get(v.targetMethodId) ?? null : null,
    targetDatabaseName: v.targetDatabaseId ? databaseById.get(v.targetDatabaseId) ?? null : null,
  });

  const newViolations = pipelineResult.added.map(denormalize);

  // Resolved rows: hydrate full rows from baseline LATEST using the ids we got back.
  const latestById = new Map(latest.violations.map((v) => [v.id, v]));
  const resolvedViolations = pipelineResult.resolvedRefs
    .map((r) => latestById.get(r.id))
    .filter((v): v is ViolationWithNames => !!v);

  // Compute affected node IDs as NAME-based keys (what the dashboard looks up).
  // Shapes match `packages/shared/src/types/entity.ts`:
  //   services: "<serviceName>"
  //   layers:   "<serviceName>::<layerName>"
  //   modules:  "<serviceName>::<moduleName>"
  //   methods:  "<serviceName>::<moduleName>::<methodName>"
  // git status returns paths relative to the target repo root. Resolve
  // against `repoPath`, not the server's cwd (which would be the monorepo
  // root in dev mode). Module filePaths are absolute inside the target repo.
  const changedAbs = new Set(
    changedFiles.map((c) => path.resolve(repoPath, c.path)),
  );
  const matchesChanged = (p: string | null | undefined) =>
    !!p && (changedAbs.has(p) || changedAbs.has(path.resolve(repoPath, p)));

  // Use the working-tree graph (not the baseline) so newly-added modules and
  // methods get highlighted. A module only in the baseline (deleted file)
  // won't render as a node anyway, so missing it here is fine.
  const affectedModules = graph.modules.filter((m) => matchesChanged(m.filePath));
  const affectedModuleIdSet = new Set(affectedModules.map((m) => m.id));

  const serviceNameById = new Map(graph.services.map((s) => [s.id, s.name]));
  const layerKeyById = new Map(
    graph.layers.map((l) => [l.id, `${l.serviceName}::${l.layer}`]),
  );

  const affectedServices = new Set<string>();
  const affectedLayers = new Set<string>();
  const affectedModuleKeys = new Set<string>();
  for (const mod of affectedModules) {
    const svcName = serviceNameById.get(mod.serviceId);
    if (svcName) {
      affectedServices.add(svcName);
      affectedModuleKeys.add(`${svcName}::${mod.name}`);
    }
    const layerKey = layerKeyById.get(mod.layerId);
    if (layerKey) affectedLayers.add(layerKey);
  }

  const moduleNameById = new Map(graph.modules.map((m) => [m.id, m.name]));
  const affectedMethodKeys: string[] = [];
  for (const method of graph.methods) {
    if (!affectedModuleIdSet.has(method.moduleId)) continue;
    const modName = moduleNameById.get(method.moduleId);
    const mod = graph.modules.find((m) => m.id === method.moduleId);
    const svcName = mod ? serviceNameById.get(mod.serviceId) : undefined;
    if (svcName && modName) affectedMethodKeys.push(`${svcName}::${modName}::${method.name}`);
  }

  return {
    id: analysisId,
    baseAnalysisId: latest.analysis.id,
    createdAt: params.now,
    branch,
    commitHash,
    graph,
    changedFiles,
    newViolations,
    resolvedViolations,
    affectedNodeIds: {
      services: [...affectedServices],
      layers: [...affectedLayers],
      modules: [...affectedModuleKeys],
      methods: affectedMethodKeys,
    },
    summary: {
      newCount: newViolations.length,
      unchangedCount: pipelineResult.unchanged.length,
      resolvedCount: resolvedViolations.length,
    },
  };
}
