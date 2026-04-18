/**
 * Unified analyze pipeline — the single computation path shared by:
 *   - full analyze  (`POST /api/repos/:id/analyze`, `truecourse analyze`)
 *   - diff analyze  (`POST /api/repos/:id/diff-check`, `truecourse analyze --diff`)
 *
 * The two modes differ only in:
 *   - `skipStash`: full stashes → parses HEAD; diff keeps the working tree.
 *   - Persistence target: full writes analyses/* + LATEST + history; diff writes diff.json.
 *   - Violation file shape: full delta-stores; diff hydrates.
 *
 * Everything else — parse, graph, violation pipeline, LLM prompt, usage
 * draining, location-invariant enforcement — is identical. Persistence lives
 * in `analyze-persist.ts`; this module returns the fully-computed result and
 * doesn't touch disk beyond acquiring the analyze lock.
 */

import { randomUUID } from 'node:crypto';
import { log } from '../lib/logger.js';
import { getGit } from '../lib/git.js';
import { readProjectConfig } from '../config/project-config.js';
import { touchProject } from '../config/registry.js';
import type { RegistryEntry } from '../config/registry.js';
import { runAnalysis, type AnalysisResult } from '../services/analyzer.service.js';
import { buildGraph } from '../services/analysis-persistence.service.js';
import { detectFlows } from '../services/flow.service.js';
import { runViolationPipeline } from '../services/violation-pipeline.service.js';
import { createLLMProvider, type LLMProvider } from '../services/llm/provider.js';
import { toUsageRecords } from '../services/usage.service.js';
import { readLatest } from '../lib/analysis-store.js';
import {
  AnalyzeLockError,
  acquireAnalyzeLock,
  releaseAnalyzeLock,
} from '../lib/atomic-write.js';
import type { Graph, LatestSnapshot, UsageRecord, ViolationRecord } from '../types/snapshot.js';
import type { StepTracker } from '../socket/handlers.js';

export type AnalysisMode = 'full' | 'diff';

export interface LlmEstimate {
  totalEstimatedTokens: number;
  tiers: {
    tier: string;
    ruleCount: number;
    fileCount: number;
    functionCount?: number;
    estimatedTokens: number;
  }[];
  uniqueFileCount?: number;
  uniqueRuleCount?: number;
}

export interface AnalyzeCoreOptions {
  mode: AnalysisMode;
  branch?: string | null;
  commitHash?: string | null;
  /** Full-mode only: skip git branch/commit/diff calls entirely. Ignored in diff mode. */
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

export interface AnalyzeCoreResult {
  mode: AnalysisMode;
  analysisId: string;
  now: string;
  branch: string | null;
  commitHash: string | null;
  architecture: 'monolith' | 'microservices';
  metadata: Record<string, unknown> | null;
  graph: Graph;
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  pipelineResult: Awaited<ReturnType<typeof runViolationPipeline>>;
  usage: UsageRecord[];
  /** Pointer to the LATEST at the time this run started. Full mode: source of
   *  carried-forward unchanged violations when materializing the new LATEST.
   *  Diff mode: source of hydrated resolved rows for diff.json. */
  latestBaseline: LatestSnapshot | null;
  /** Id of the previous LATEST analysis, stamped into AnalysisSnapshot.violations.previousAnalysisId. */
  previousAnalysisId: string | null;
  analysisResult: AnalysisResult;
}

export async function analyzeCore(
  project: RegistryEntry,
  options: AnalyzeCoreOptions,
): Promise<AnalyzeCoreResult> {
  // Single lock protects both modes. A diff while an analyze is in-flight (or
  // vice versa) corrupts LATEST / diff.json invariants, so block both.
  try {
    acquireAnalyzeLock(project.path);
  } catch (err) {
    if (err instanceof AnalyzeLockError) throw err;
    throw err;
  }

  try {
    const { mode, signal } = options;
    const isDiff = mode === 'diff';
    const skipGit = !isDiff && !!options.skipGit;
    const projectConfig = readProjectConfig(project.path);

    const latestBaseline = readLatest(project.path);
    if (isDiff && !latestBaseline) {
      throw new Error('Run a full analysis first before checking a diff.');
    }

    // ------------------------------------------------------------
    // Branch / commit metadata
    // ------------------------------------------------------------
    let branch: string | null = options.branch ?? null;
    let commitHash: string | null = options.commitHash ?? null;
    if (isDiff) {
      // Diff inherits branch from the baseline so the violation pipeline can
      // compare like-for-like. Commit hash reflects the working tree's HEAD.
      branch = latestBaseline!.analysis.branch ?? branch;
      if (commitHash === null) {
        try {
          const git = await getGit(project.path);
          commitHash = (await git.revparse(['HEAD'])).trim() || null;
        } catch {
          commitHash = null;
        }
      }
    } else if (!skipGit && (branch === null || commitHash === null)) {
      const git = await getGit(project.path);
      if (branch === null) branch = (await git.branch()).current || null;
      if (commitHash === null) commitHash = (await git.revparse(['HEAD'])).trim();
    }

    const analysisId = randomUUID();
    const now = new Date().toISOString();
    const start = Date.now();

    const effectiveCategories = options.enabledCategoriesOverride?.length
      ? options.enabledCategoriesOverride
      : projectConfig.enabledCategories ?? undefined;
    const effectiveLlmRules =
      projectConfig.enableLlmRules ?? options.enableLlmRulesOverride ?? true;

    // ------------------------------------------------------------
    // Parse the code
    // ------------------------------------------------------------
    options.tracker?.start('parse', isDiff ? 'Analyzing working tree...' : 'Starting analysis...');
    const result: AnalysisResult = await runAnalysis(
      project.path,
      branch ?? undefined,
      (progress) => {
        options.tracker?.detail('parse', progress.detail ?? 'Analyzing...');
        options.onProgress?.({ detail: progress.detail });
      },
      { signal, skipStash: isDiff },
    );

    if (signal?.aborted) {
      throw new DOMException(isDiff ? 'Diff cancelled' : 'Analysis cancelled', 'AbortError');
    }

    // ------------------------------------------------------------
    // Graph
    // ------------------------------------------------------------
    const { graph, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap } = buildGraph(result);

    // ------------------------------------------------------------
    // Changed files (diff) / incremental commit diff (full)
    //
    // Diff reports working-tree changes for UI display and affected-node
    // computation. Full mode uses a separate `git diff <baseline-commit>..HEAD`
    // to cut LLM scan cost when only a few files changed between commits.
    // Note: `changedFiles` on the result stays empty in full mode because a
    // successful stash left nothing dirty to report.
    // ------------------------------------------------------------
    let changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }> = [];
    let changedFileSet: Set<string> | undefined;

    if (isDiff) {
      try {
        const git = await getGit(project.path);
        const statusResult = await git.status();
        for (const f of statusResult.not_added) changedFiles.push({ path: f, status: 'new' });
        for (const f of statusResult.created) changedFiles.push({ path: f, status: 'new' });
        for (const f of statusResult.modified) changedFiles.push({ path: f, status: 'modified' });
        for (const f of statusResult.staged) {
          if (!changedFiles.some((cf) => cf.path === f)) {
            changedFiles.push({ path: f, status: 'modified' });
          }
        }
        for (const f of statusResult.deleted) changedFiles.push({ path: f, status: 'deleted' });
      } catch (err) {
        log.warn(`[Diff] git status failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (latestBaseline?.analysis.commitHash && !skipGit) {
      try {
        const git = await getGit(project.path);
        const diffOutput = await git.diff([latestBaseline.analysis.commitHash, 'HEAD', '--name-only']);
        const files = diffOutput.trim().split('\n').filter(Boolean);
        if (files.length > 0) changedFileSet = new Set(files);
      } catch {
        /* diff unavailable — analyze all files */
      }
    }

    // ------------------------------------------------------------
    // Flows (full mode only — diff doesn't persist a new graph snapshot
    // into LATEST, and the UI's flow view always reads LATEST's graph)
    // ------------------------------------------------------------
    if (!isDiff) {
      try {
        graph.flows = detectFlows(result);
      } catch (flowError) {
        log.error(
          `[Flows] Detection failed: ${flowError instanceof Error ? flowError.message : String(flowError)}`,
        );
        graph.flows = [];
      }
      touchProject(project.slug);
    }

    options.tracker?.done(
      'parse',
      `${result.services.length} services, ${result.fileAnalyses?.length ?? 0} files`,
    );

    // ------------------------------------------------------------
    // Previous active violation set for lifecycle
    // ------------------------------------------------------------
    const previousActiveViolations = latestBaseline
      ? latestBaseline.violations.filter(
          (v) => (branch == null || latestBaseline.analysis.branch == null || latestBaseline.analysis.branch === branch),
        )
      : [];
    const previousAnalysisId = latestBaseline?.analysis.id ?? null;

    // ------------------------------------------------------------
    // Violation pipeline
    // ------------------------------------------------------------
    const provider = options.provider ?? (effectiveLlmRules ? createLLMProvider() : undefined);
    if (provider) {
      provider.setAnalysisId(analysisId);
      provider.setRepoPath(project.path);
      if (signal) provider.setAbortSignal(signal);
    }

    const pipelineResult = await runViolationPipeline({
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

    // Apply LLM-generated service descriptions to the graph in-place.
    if (pipelineResult.serviceDescriptions.length > 0) {
      for (const desc of pipelineResult.serviceDescriptions) {
        const svc = graph.services.find((s) => s.id === desc.id);
        if (svc) svc.description = desc.description;
      }
    }

    // Drain LLM usage before the pipelineResult is frozen into a snapshot.
    const usage = provider ? toUsageRecords(provider.flushUsage()) : [];

    // Enforce the location invariant on every violation: a filePath always
    // comes with a line range, or neither. Any partial gets normalized here
    // so downstream consumers can trust the contract.
    enforceLocationInvariant(pipelineResult.added);
    enforceLocationInvariant(pipelineResult.unchanged);
    enforceLocationInvariant(pipelineResult.resolved);

    log.info(
      `[${isDiff ? 'Diff' : 'Analysis'}] core complete in ${Date.now() - start}ms — ${pipelineResult.added.length} added, ${pipelineResult.unchanged.length} unchanged, ${pipelineResult.resolvedRefs.length} resolved`,
    );

    return {
      mode,
      analysisId,
      now,
      branch,
      commitHash,
      architecture: result.architecture,
      metadata: result.metadata ?? null,
      graph,
      changedFiles,
      pipelineResult,
      usage,
      latestBaseline,
      previousAnalysisId,
      analysisResult: result,
    };
  } finally {
    releaseAnalyzeLock(project.path);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

