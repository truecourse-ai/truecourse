import { randomUUID } from 'node:crypto';
import { log } from '../lib/logger.js';
import { getGit } from '../lib/git.js';
import { readProjectConfig } from '../config/project-config.js';
import { setLastAnalyzed, touchProject } from '../config/registry.js';
import type { RegistryEntry } from '../config/registry.js';
import { runAnalysis, type AnalysisResult } from '../services/analyzer.service.js';
import { buildGraph } from '../services/analysis-persistence.service.js';
import { detectFlows } from '../services/flow.service.js';
import { runViolationPipeline } from '../services/violation-pipeline.service.js';
import { createLLMProvider, type LLMProvider } from '../services/llm/provider.js';
import { toUsageRecords } from '../services/usage.service.js';
import {
  appendHistory,
  buildAnalysisFilename,
  deleteDiff,
  readLatest,
  removeFromHistory,
  writeAnalysis,
  writeLatest,
} from '../lib/analysis-store.js';
import {
  AnalyzeLockError,
  acquireAnalyzeLock,
  releaseAnalyzeLock,
} from '../lib/atomic-write.js';
import type {
  AnalysisSnapshot,
  HistoryEntry,
  LatestSnapshot,
  ViolationRecord,
  ViolationSeverity,
  ViolationWithNames,
} from '../types/snapshot.js';
import type { ActiveViolation } from '../services/violation-lifecycle.service.js';
import type { StepTracker } from '../socket/handlers.js';

export interface LlmEstimate {
  totalEstimatedTokens: number;
  tiers: { tier: string; ruleCount: number; fileCount: number; functionCount?: number; estimatedTokens: number }[];
  uniqueFileCount?: number;
  uniqueRuleCount?: number;
}

export interface AnalyzeInProcessOptions {
  branch?: string | null;
  commitHash?: string | null;
  /** Skip all git commands (branch detection, commit hash, diff). */
  skipGit?: boolean;
  enabledCategoriesOverride?: string[];
  enableLlmRulesOverride?: boolean;
  tracker?: StepTracker;
  onProgress?: (progress: { detail?: string }) => void;
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  onLlmResolved?: (proceed: boolean) => void;
  provider?: LLMProvider;
  signal?: AbortSignal;
}

export interface AnalyzeInProcessResult {
  analysisId: string;
  filename: string;
  serviceCount: number;
  fileCount: number;
  architecture: string;
  durationMs: number;
  violationsSummary: { total: number; bySeverity: Record<string, number> };
}

/**
 * Core analyze pipeline used by both the `truecourse analyze` CLI command
 * and the server's UI-triggered `POST /analyze` route. Assembles an
 * `AnalysisSnapshot` in memory and writes the JSON file store (per-analysis
 * file + LATEST + history) atomically at the end.
 */
export async function analyzeInProcess(
  project: RegistryEntry,
  options: AnalyzeInProcessOptions = {},
): Promise<AnalyzeInProcessResult> {
  // Concurrent writes against the same repo corrupt LATEST; the lock also
  // protects the invariant that diff.json always points at the current
  // baseline.
  try {
    acquireAnalyzeLock(project.path);
  } catch (err) {
    if (err instanceof AnalyzeLockError) throw err;
    throw err;
  }

  try {
    const start = Date.now();
    const { skipGit, signal } = options;
    const projectConfig = readProjectConfig(project.path);

    let branch: string | null = options.branch ?? null;
    let commitHash: string | null = options.commitHash ?? null;
    if (!skipGit && (branch === null || commitHash === null)) {
      const git = await getGit(project.path);
      if (branch === null) branch = (await git.branch()).current || null;
      if (commitHash === null) commitHash = (await git.revparse(['HEAD'])).trim();
    }

    const analysisId = randomUUID();
    const now = new Date().toISOString();
    const filename = buildAnalysisFilename(analysisId, now);

    const effectiveCategories = options.enabledCategoriesOverride?.length
      ? options.enabledCategoriesOverride
      : projectConfig.enabledCategories ?? undefined;
    const effectiveLlmRules =
      projectConfig.enableLlmRules ?? options.enableLlmRulesOverride ?? true;

    options.tracker?.start('parse', 'Starting analysis...');
    const result: AnalysisResult = await runAnalysis(
      project.path,
      branch ?? undefined,
      (progress) => {
        options.tracker?.detail('parse', progress.detail ?? 'Analyzing...');
        options.onProgress?.({ detail: progress.detail });
      },
      { signal },
    );

    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');

    // ------------------------------------------------------------
    // Build the graph (in memory)
    // ------------------------------------------------------------
    const { graph, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap } = buildGraph(result);

    // ------------------------------------------------------------
    // Load previous active violations from LATEST
    // ------------------------------------------------------------
    const previousLatest = readLatest(project.path);
    const previousAnalysisId = previousLatest?.analysis.id ?? null;
    const previousActiveViolations: ActiveViolation[] = previousLatest
      ? previousLatest.violations.filter(
          (v) => (branch == null || previousLatest.analysis.branch == null || previousLatest.analysis.branch === branch),
        )
      : [];

    // ------------------------------------------------------------
    // Flows
    // ------------------------------------------------------------
    try {
      graph.flows = detectFlows(result);
    } catch (flowError) {
      log.error(`[Flows] Detection failed: ${flowError instanceof Error ? flowError.message : String(flowError)}`);
      graph.flows = [];
    }

    touchProject(project.slug);

    // ------------------------------------------------------------
    // Incremental file detection based on commit diff
    // ------------------------------------------------------------
    let changedFileSet: Set<string> | undefined;
    if (previousLatest?.analysis.commitHash && !skipGit) {
      try {
        const git = await getGit(project.path);
        const diffOutput = await git.diff([previousLatest.analysis.commitHash, 'HEAD', '--name-only']);
        const files = diffOutput.trim().split('\n').filter(Boolean);
        if (files.length > 0) changedFileSet = new Set(files);
      } catch {
        // diff unavailable — analyze all files
      }
    }

    options.tracker?.done(
      'parse',
      `${result.services.length} services, ${result.fileAnalyses?.length ?? 0} files`,
    );

    // ------------------------------------------------------------
    // Violations
    // ------------------------------------------------------------
    const provider = options.provider ?? (effectiveLlmRules ? createLLMProvider() : undefined);
    if (provider) {
      provider.setAnalysisId(analysisId);
      provider.setRepoPath(project.path);
      if (signal) provider.setAbortSignal(signal);
    }

    let pipelineResult;
    try {
      pipelineResult = await runViolationPipeline({
        repoPath: project.path,
        analysisId,
        now,
        result,
        serviceIdMap,
        moduleIdMap,
        methodIdMap,
        dbIdMap,
        previousActiveViolations,
        changedFileSet,
        tracker: options.tracker,
        enabledCategories: effectiveCategories,
        enableLlmRules: effectiveLlmRules,
        provider,
        signal,
        onLlmEstimate: options.onLlmEstimate
          ? async (estimate) => {
              const proceed = await options.onLlmEstimate!(estimate);
              options.onLlmResolved?.(proceed);
              return proceed;
            }
          : undefined,
      });
    } finally {
      // LLM provider usage is drained regardless of pipeline outcome so the
      // snapshot records whatever calls were made before an abort.
    }

    // Apply LLM-generated service descriptions to the graph in-place.
    if (pipelineResult.serviceDescriptions.length > 0) {
      for (const desc of pipelineResult.serviceDescriptions) {
        const svc = graph.services.find((s) => s.id === desc.id);
        if (svc) svc.description = desc.description;
      }
    }

    // Drain LLM usage before we build the snapshot so it's included.
    const usage = provider ? toUsageRecords(provider.flushUsage()) : [];

    // Enforce the location invariant on every violation: a `filePath` must
    // come with `lineStart` + `lineEnd`, or all three must be null. Any rule
    // that slips (new or future) gets normalized here so consumers can
    // trust the contract — CodeViewer can drop its null-guards, etc.
    enforceLocationInvariant(pipelineResult.added);
    enforceLocationInvariant(pipelineResult.unchanged);
    enforceLocationInvariant(pipelineResult.resolved);

    // ------------------------------------------------------------
    // Assemble AnalysisSnapshot
    // ------------------------------------------------------------
    const snapshot: AnalysisSnapshot = {
      id: analysisId,
      createdAt: now,
      branch,
      commitHash,
      architecture: result.architecture,
      status: 'completed',
      metadata: result.metadata ?? null,
      graph,
      violations: {
        added: pipelineResult.added,
        resolved: pipelineResult.resolvedRefs,
        previousAnalysisId,
      },
      usage,
    };

    // ------------------------------------------------------------
    // Materialize LATEST
    // ------------------------------------------------------------
    const latest = buildLatestSnapshot(snapshot, filename, pipelineResult.unchanged, pipelineResult.added);

    const { bySeverity, total } = summarizeActiveViolations(latest.violations);

    // ------------------------------------------------------------
    // Atomic write sequence
    // ------------------------------------------------------------
    writeAnalysis(project.path, snapshot);
    writeLatest(project.path, latest);

    const historyEntry = buildHistoryEntry(snapshot, filename, pipelineResult);
    appendHistory(project.path, historyEntry);

    // Baseline moved — any prior diff is obsolete.
    deleteDiff(project.path);

    setLastAnalyzed(project.slug, now);

    return {
      analysisId,
      filename,
      serviceCount: result.services.length,
      fileCount: result.fileAnalyses?.length ?? 0,
      architecture: result.architecture,
      durationMs: Date.now() - start,
      violationsSummary: { total, bySeverity },
    };
  } finally {
    releaseAnalyzeLock(project.path);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLatestSnapshot(
  snapshot: AnalysisSnapshot,
  filename: string,
  unchanged: ViolationRecord[],
  added: ViolationRecord[],
): LatestSnapshot {
  const { graph } = snapshot;
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

  return {
    head: filename,
    analysis: {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      branch: snapshot.branch,
      commitHash: snapshot.commitHash,
      architecture: snapshot.architecture,
      metadata: snapshot.metadata,
      status: 'completed',
    },
    graph,
    violations: [...added.map(denormalize), ...unchanged.map(denormalize)],
  };
}

function summarizeActiveViolations(
  violations: ViolationWithNames[],
): { total: number; bySeverity: Record<string, number> } {
  const bySeverity: Record<string, number> = {};
  let total = 0;
  for (const v of violations) {
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    total++;
  }
  return { total, bySeverity };
}

function buildHistoryEntry(
  snapshot: AnalysisSnapshot,
  filename: string,
  pipeline: import('../services/violation-pipeline.service.js').ViolationPipelineResult,
): HistoryEntry {
  const bySeverity: Record<ViolationSeverity, number> = {
    info: 0, low: 0, medium: 0, high: 0, critical: 0,
  };
  for (const v of [...pipeline.added, ...pipeline.unchanged]) {
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
  }

  const totalTokens = snapshot.usage.reduce((s, u) => s + u.totalTokens, 0);
  const totalDurationMs = snapshot.usage.reduce((s, u) => s + u.durationMs, 0);
  let totalCostSum = 0;
  let anyCost = false;
  for (const u of snapshot.usage) {
    if (u.costUsd) {
      const n = Number(u.costUsd);
      if (!Number.isNaN(n)) { totalCostSum += n; anyCost = true; }
    }
  }
  const provider = snapshot.usage.length > 0 ? snapshot.usage[0].provider : '';

  return {
    id: snapshot.id,
    filename,
    createdAt: snapshot.createdAt,
    branch: snapshot.branch,
    commitHash: snapshot.commitHash,
    metadata: snapshot.metadata,
    counts: {
      services: snapshot.graph.services.length,
      modules: snapshot.graph.modules.length,
      methods: snapshot.graph.methods.length,
      violations: {
        new: pipeline.added.length,
        unchanged: pipeline.unchanged.length,
        resolved: pipeline.resolved.length,
        bySeverity,
      },
    },
    usage: {
      totalTokens,
      totalCostUsd: anyCost ? totalCostSum.toFixed(6) : '0',
      durationMs: totalDurationMs,
      provider,
    },
  };
}

// Re-export so the route can detect and remove a specific analysis's history entry.
export { removeFromHistory };

/**
 * Normalize the filePath / lineStart / lineEnd triple on every violation in
 * place. The invariant: a filePath always comes with a line range, or none
 * of the three are set. If a rule produces one without the others, we log
 * and drop the partial location so downstream consumers never see filePath
 * without lines (or vice versa).
 */
function enforceLocationInvariant(violations: ViolationRecord[]): void {
  for (const v of violations) {
    const hasFile = v.filePath != null;
    const hasRange = v.lineStart != null && v.lineEnd != null;
    if (hasFile === hasRange) continue;

    log.warn(
      `[Violations] ${v.ruleKey}: partial location (filePath=${v.filePath}, lineStart=${v.lineStart}, lineEnd=${v.lineEnd}) — dropping to uphold the location invariant`,
    );
    v.filePath = null;
    v.lineStart = null;
    v.lineEnd = null;
  }
}
