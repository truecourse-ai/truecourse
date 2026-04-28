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
import path from 'node:path';
import { log } from '../lib/logger.js';
import { getGit } from '../lib/git.js';
import { readProjectConfig } from '../config/project-config.js';
import { touchProject } from '../config/registry.js';
import type { RegistryEntry } from '../config/registry.js';
import { runAnalysis, type AnalysisResult } from '../services/analyzer.service.js';
import { buildGraph } from '../services/analysis-persistence.service.js';
import { detectFlows } from '../services/flow.service.js';
import { runViolationPipeline } from '../services/violation-pipeline.service.js';
import { enforceInvariants } from '../services/invariants/enforce.js';
import { mapInvariantViolations } from '../services/invariants/snapshot-mapper.js';
import { estimateInvariantEnforcement } from '../services/invariants/estimator.js';
import { createLLMProvider, type LLMProvider } from '../services/llm/provider.js';
import { toUsageRecords } from '../services/usage.service.js';
import { readLatest } from '../lib/analysis-store.js';
import {
  AnalyzeLockError,
  acquireAnalyzeLock,
  releaseAnalyzeLock,
} from '../lib/atomic-write.js';
import type { Graph, LatestSnapshot, UsageRecord, ViolationRecord } from '../types/snapshot.js';
import type { StepTracker } from '../progress.js';

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
  /**
   * Full-mode only: analyze the working tree as-is instead of stashing
   * dirty changes first. Diff mode always skips stashing regardless.
   */
  skipStash?: boolean;
  enabledCategoriesOverride?: string[];
  enableLlmRulesOverride?: boolean;
  tracker?: StepTracker;
  onProgress?: (progress: { detail?: string }) => void;
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  onLlmResolved?: (proceed: boolean) => void;
  /**
   * Separate prompt for invariant LLM cost. Fires after the rule pipeline
   * returns and before invariant enforcement runs, only when there's
   * non-zero invariant LLM cost. The user can approve or skip independently
   * of the rule-LLM decision (a plugin like `state-machine` is fully
   * deterministic and runs regardless).
   */
  onInvariantsLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  onInvariantsLlmResolved?: (proceed: boolean) => void;
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
    // Stash dirty working tree so the entire pipeline (parse + LLM scan +
    // persist) sees the committed state. Diff mode never stashes — it
    // analyzes the working tree by design.
    // ------------------------------------------------------------
    let didStash = false;
    let stashGit: Awaited<ReturnType<typeof getGit>> | undefined;
    if (!isDiff && !skipGit && !options.skipStash) {
      try {
        stashGit = await getGit(project.path);
        const status = await stashGit.status();
        if (!status.isClean()) {
          const gitRoot = (await stashGit.revparse(['--show-toplevel'])).trim();
          // Skip stashing when the repo path is a subdirectory of a larger
          // repo (e.g., test fixtures inside the main repo). Stashing there
          // would touch unrelated parent-repo files.
          const isSubdirectory = path.resolve(project.path) !== path.resolve(gitRoot);
          if (!isSubdirectory) {
            options.tracker?.detail('parse', 'Stashing pending changes...');
            options.onProgress?.({ detail: 'Stashing pending changes to analyze committed state...' });
            const stashResult = await stashGit.stash([
              'push',
              '--include-untracked',
              '-m',
              'truecourse-analysis-stash',
            ]);
            // git stash push prints "No local changes to save" if nothing to stash
            didStash = !stashResult.includes('No local changes');
          }
        }
      } catch (error) {
        log.warn(
          `[Analyzer] Failed to stash changes, analyzing current state: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

  try {
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
      { signal },
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
    //
    // Provider is provisioned whenever LLM checks COULD run — either rule
    // LLM is enabled at config level, or there are active invariants whose
    // enforcement uses the LLM. This way the pre-flight prompt sees the
    // combined cost and the user makes a single decision for the run.
    // ------------------------------------------------------------
    const invariantEstimate = estimateInvariantEnforcement(project.path);
    const invariantsNeedLlm = invariantEstimate.totalLlmCalls > 0;
    const provider =
      options.provider ??
      (effectiveLlmRules || invariantsNeedLlm ? createLLMProvider() : undefined);
    if (provider) {
      provider.setAnalysisId(analysisId);
      provider.setRepoPath(project.path);
      if (signal) provider.setAbortSignal(signal);
    }

    // ------------------------------------------------------------
    // Run rule pipeline + invariant enforcement in PARALLEL with two
    // separate cost prompts.
    //
    // Sequence the user sees (for a typical run with both LLM rules and
    // LLM-using invariants):
    //   1. Rule pipeline starts → fires rule-LLM prompt → user answers.
    //   2. Immediately after, invariant phase fires invariant-LLM prompt →
    //      user answers.
    //   3. Both phases run concurrently. The shared LLMProvider's global
    //      concurrency cap (CLAUDE_CODE_MAX_CONCURRENCY) throttles them
    //      together so they cooperate rather than oversubscribe.
    //
    // `ruleDecided` is the gate that lets the invariant phase fire its
    // prompt only after the rule prompt resolves (or after we know no rule
    // prompt will fire), so the user never sees both prompts on top of
    // each other in the CLI.
    // ------------------------------------------------------------
    let ruleDecisionResolve!: (proceed: boolean) => void;
    const ruleDecided: Promise<boolean> = new Promise((r) => {
      ruleDecisionResolve = r;
    });
    let invariantsDecisionResolve!: (proceed: boolean) => void;
    const invariantsDecided: Promise<boolean> = new Promise((r) => {
      invariantsDecisionResolve = r;
    });
    if (!effectiveLlmRules) {
      // Rule LLM phase is config-disabled → pipeline won't fire prompt.
      // Resolve now so the invariant phase doesn't have to wait for the
      // rule pipeline (deterministic-only) to finish before its prompt.
      ruleDecisionResolve(true);
    }
    if (!invariantsNeedLlm) {
      // No invariant LLM cost → no invariant prompt will fire. Resolve so
      // the rule pipeline's onLlmEstimate wrapper doesn't block waiting on
      // a prompt that won't happen.
      invariantsDecisionResolve(true);
    }

    const pipelinePromise = runViolationPipeline({
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
            ruleDecisionResolve(proceed);
            // Block rule-LLM execution until the invariants prompt has
            // also been answered, so the user sees both prompts back-to-
            // back at the start instead of having rule-LLM start running
            // mid-prompt.
            await invariantsDecided;
            return proceed;
          }
        : undefined,
    }).then((res) => {
      // Backstop — if the pipeline never fired the prompt (e.g. LLM rules
      // enabled at config but no LLM rule actually applies), resolve
      // ruleDecided so the invariant phase unblocks. Idempotent if the
      // wrapper already resolved.
      ruleDecisionResolve(true);
      return res;
    });

    const invariantsPromise = (async () => {
      // Wait for rule prompt to be answered (or for the pipeline to finish
      // without firing one) so the two prompts don't overlap.
      await ruleDecided;

      let invariantsApproved = !invariantsNeedLlm;
      if (invariantsNeedLlm) {
        if (options.onInvariantsLlmEstimate) {
          const invariantsEstimate: LlmEstimate = {
            totalEstimatedTokens: invariantEstimate.totalEstimatedTokens,
            tiers: [
              {
                tier: 'invariants',
                ruleCount: invariantEstimate.activeCount,
                fileCount: invariantEstimate.totalLlmCalls,
                estimatedTokens: invariantEstimate.totalEstimatedTokens,
              },
            ],
            uniqueFileCount: invariantEstimate.filePaths.length,
            uniqueRuleCount: invariantEstimate.activeCount,
          };
          log.info(
            `[Invariants] Pre-flight: ${invariantEstimate.totalEstimatedTokens} estimated tokens, ` +
              `${invariantEstimate.activeCount} active across ${invariantEstimate.filePaths.length} file(s)`,
          );
          try {
            invariantsApproved = await options.onInvariantsLlmEstimate(invariantsEstimate);
          } catch (err) {
            log.warn(
              `[Invariants] prompt failed: ${err instanceof Error ? err.message : String(err)} — proceeding`,
            );
            invariantsApproved = true;
          }
          options.onInvariantsLlmResolved?.(invariantsApproved);
          if (!invariantsApproved) {
            log.info(`[Invariants] LLM enforcement skipped by user`);
          }
        } else {
          // Non-interactive caller didn't wire a prompt — default to running.
          invariantsApproved = true;
        }
      }

      // Unblock rule-LLM execution. Set BEFORE running enforce so rule LLM
      // and invariant LLM start in parallel rather than serializing the
      // invariant prompt's resolution behind invariant enforcement.
      invariantsDecisionResolve(invariantsApproved);

      const llmForInvariants = invariantsApproved ? provider : undefined;
      const invariantsStarted = Date.now();
      try {
        const enforceResult = await enforceInvariants({
          repoPath: project.path,
          llm: llmForInvariants,
          files: result.fileAnalyses,
          onProgress: (event) => {
            const stepKey = `invariant:${event.pluginType}`;
            if (event.kind === 'plugin-start') {
              options.tracker?.start(
                stepKey,
                `LLM 0/${event.activeCount}`,
              );
            } else if (event.kind === 'plugin-progress') {
              const parts: string[] = [`LLM ${event.done}/${event.total}`];
              if (event.running > 0) parts.push(`${event.running} running`);
              if (event.elapsedMs >= 1000) {
                const totalSec = Math.floor(event.elapsedMs / 1000);
                const min = Math.floor(totalSec / 60);
                const sec = totalSec % 60;
                parts.push(min === 0 ? `${sec}s` : `${min}m ${sec}s`);
              }
              options.tracker?.detail(stepKey, parts.join(' · '));
            } else if (event.kind === 'plugin-done') {
              options.tracker?.done(
                stepKey,
                `${event.violations} violation${event.violations === 1 ? '' : 's'}`,
              );
            } else if (event.kind === 'plugin-failed') {
              options.tracker?.error(stepKey, 'enforcement failed (see logs)');
            }
          },
        });
        log.info(
          `[Invariants] enforce: ${enforceResult.violations.length} violation(s), ` +
            `plugins run=${enforceResult.pluginsRun.join(',') || '(none)'}, ` +
            `skipped=${enforceResult.pluginsSkipped.join(',') || '(none)'}, ` +
            `llm=${llmForInvariants ? 'on' : 'off'} (${Date.now() - invariantsStarted}ms)`,
        );
        return enforceResult;
      } catch (err) {
        log.error(
          `[Invariants] enforce failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          violations: [] as import('@truecourse/shared').Violation[],
          pluginsRun: [],
          pluginsSkipped: [],
        };
      }
    })();

    const [pipelineResult, enforceResult] = await Promise.all([
      pipelinePromise,
      invariantsPromise,
    ]);

    // Apply LLM-generated service descriptions to the graph in-place.
    if (pipelineResult.serviceDescriptions.length > 0) {
      for (const desc of pipelineResult.serviceDescriptions) {
        const svc = graph.services.find((s) => s.id === desc.id);
        if (svc) svc.description = desc.description;
      }
    }

    // Merge invariant violations into the snapshot stream. Done after both
    // phases complete so the snapshot mapper sees the final current set
    // and computes lifecycle (added/unchanged/resolved) against the same
    // previousActiveViolations the rule pipeline used.
    {
      const split = mapInvariantViolations({
        current: enforceResult.violations,
        previousActive: previousActiveViolations,
        analysisId,
        now,
      });
      pipelineResult.added.push(...split.added);
      pipelineResult.unchanged.push(...split.unchanged);
      pipelineResult.resolved.push(...split.resolved);
      pipelineResult.resolvedRefs.push(...split.resolvedRefs);
      log.info(
        `[Invariants] snapshot: ${split.added.length} new + ${split.unchanged.length} unchanged + ${split.resolved.length} resolved`,
      );
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
      if (didStash && stashGit) {
        options.tracker?.detail('parse', 'Restoring pending changes...');
        options.onProgress?.({ detail: 'Restoring pending changes...' });
        try {
          await stashGit.stash(['pop']);
        } catch (error) {
          log.error(
            `[Analyzer] Failed to restore stashed changes. Run "git stash pop" manually. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
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

