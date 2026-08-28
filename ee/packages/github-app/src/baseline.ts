/**
 * Baseline capture: clone a repo's default branch, curate its spec (conflict
 * detection), and run the Code Quality analyze pass — establishing the per-repo
 * baseline the PR gate compares against. Refreshed whenever the default branch
 * advances (merge).
 *
 * A repo with no spec docs simply produces no corpus. A scan/analyze FAILURE
 * propagates (the caller logs it) so the prior baseline is left intact and the
 * gate self-heals.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { promoteDecisionsOverlay } from '@truecourse/core/commands/spec-in-process';
import { analyzeInProcess } from '@truecourse/core/commands/analyze-in-process';
import { readLatest } from '@truecourse/core/lib/analysis-store';
import type { StepTracker } from '@truecourse/core/progress';
import type { RepoRef } from '@truecourse/core/lib/contract-store';
import { log } from '@truecourse/core/lib/logger';
import {
  type GateStore,
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
  splitRepo,
  listPrsForCommit,
  type OctokitClient,
} from '@truecourse/scm-github';
import { defaultSpecScanPipeline, type SpecScanPipeline } from './spec-scan.js';

export interface BaselineDeps {
  store: GateStore;
  auth: GithubAuth;
  /**
   * Installation-scoped GitHub client factory — used to map the merge/squash
   * commit back to its merged PR (spec-decision promotion). Omitted ⇒ PR
   * resolution is skipped and the baseline scans as before.
   */
  octokitFor?: (installationId: number) => OctokitClient;
  /** Spec-scan pipeline for the cold path (injected in tests). */
  scanPipeline?: SpecScanPipeline;
  /** Phase callback for the stepped progress popup (EE jobs). */
  onPhase?: (phase: 'clone' | 'spec' | 'analyze') => void | Promise<void>;
  /** Spec-scan tracker — driven through CURATE_STEPS for the popup's "Extracting spec" detail. */
  specTracker?: StepTracker;
}

export interface BaselineRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  /**
   * Re-run even if a baseline for this commit already exists. Used when a spec
   * conflict was resolved on an unchanged head (post-conflict-resolve), so the
   * corpus is re-curated even though the head didn't move. Webhook/connect runs
   * leave it off so a redelivered push doesn't re-clone.
   */
  force?: boolean;
  /**
   * Run the LLM (semantic) code-analysis rules in the Code Quality pass. Off by
   * default (deterministic rules always run); the caller reads the workspace's
   * `codeAnalysisLlm` setting and passes it through.
   */
  enableLlmAnalysis?: boolean;
}

/** What the baseline run produced — lets the caller word an accurate notification. */
export interface BaselineResult {
  /** Open spec conflicts found this scan; `>0` ⇒ a human should resolve them. */
  openConflicts: number;
}

/**
 * The merged PR whose merge/squash produced `commitSha`, or null. Prefers the PR
 * whose `merge_commit_sha` is exactly this commit (the unambiguous match); falls
 * back to any merged PR associated with the commit (covers squash/rebase, whose
 * landed sha differs from the recorded merge commit).
 */
export async function resolveMergedPr(
  octokit: OctokitClient,
  repoFullName: string,
  commitSha: string,
): Promise<{ number: number; headSha: string } | null> {
  const merged = (await listPrsForCommit(octokit, splitRepo(repoFullName), commitSha)).filter(
    (p) => p.merged,
  );
  if (merged.length === 0) return null;
  const chosen = merged.find((p) => p.mergeCommitSha === commitSha) ?? merged[0]!;
  return { number: chosen.number, headSha: chosen.headSha };
}

/**
 * On a default-branch push, resolve the merged PR and promote its PR-scoped spec
 * decisions onto the repo row BEFORE the merge-commit scan folds them (idempotent
 * — the pull_request.closed handler may have already promoted; this is the
 * push-before-closed race-proofing). Any failure degrades to a no-op — decision
 * promotion never fails the baseline.
 */
export async function promoteMergedPrDecisions(
  deps: Pick<BaselineDeps, 'octokitFor'>,
  req: { repoFullName: string; installationId: number; commitSha: string },
): Promise<void> {
  if (!deps.octokitFor) return;
  try {
    const merged = await resolveMergedPr(
      deps.octokitFor(req.installationId),
      req.repoFullName,
      req.commitSha,
    );
    if (!merged) return;
    await promoteDecisionsOverlay(req.repoFullName, merged.number);
  } catch (err) {
    log.warn(
      `[github-app] merged-PR decision promotion failed for ${req.repoFullName}@${req.commitSha.slice(0, 7)}: ${(err as Error).message}`,
    );
  }
}

export async function runBaseline(
  deps: BaselineDeps,
  req: BaselineRequest,
): Promise<BaselineResult> {
  // GitHub webhook delivery is at-least-once; skip if this commit is already
  // the saved baseline so a redelivered push doesn't re-clone + re-scan. A
  // `force` run (post-resolve re-baseline) bypasses this.
  const existing = await deps.store.getBaseline(req.repoFullName);
  if (!req.force && existing?.commitSha === req.commitSha) {
    log.info(
      `[github-app] baseline for ${req.repoFullName}@${req.commitSha.slice(0, 7)} already current — skipping`,
    );
    return { openConflicts: 0 };
  }

  const scanPipeline = deps.scanPipeline ?? defaultSpecScanPipeline;
  const ref: RepoRef = { repoKey: req.repoFullName, commitSha: req.commitSha };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-baseline-'));
  try {
    await deps.onPhase?.('clone');
    const token = await getInstallationToken(deps.auth, req.installationId);
    await simpleGit().clone(cloneUrl(req.repoFullName), tmp, [
      ...cloneAuthArgs(token),
      '--depth',
      '1',
      '--branch',
      req.defaultBranch,
    ]);
    await stripEmbeddedAuth(simpleGit(tmp));

    // Map this push to its merged PR and promote the PR's spec decisions before
    // the scan folds them. Degrades to a no-op on any failure.
    await promoteMergedPrDecisions(deps, req);

    // Note: the old spec→contract→infer baseline flow was retired here in favor of
    // spec→guard (scenario generate + run). The contract subsystem is dormant, kept
    // for a future spec→code linking layer; nothing runs it at baseline time.
    await deps.onPhase?.('spec');
    const { openConflicts } = await scanPipeline.scan(tmp, ref, deps.specTracker);

    // Code Quality: run the OSS analyze pass on the same clone, persisted under the
    // repo identity by the EE PgAnalysisStore (codeDir = clone; project.path = the
    // repoKey storage key). Independent of the spec — a spec-less repo still has an
    // architecture + violations. Best-effort: an analyze failure (e.g. no LLM
    // provider configured yet) must not block the baseline.
    try {
      // Code analyze depends on the CODE, not the spec — so skip it when this commit
      // already has a persisted analysis. A re-baseline (post-conflict-resolve) fires
      // at the SAME commit purely to refresh the spec corpus; re-analyzing unchanged
      // code would reproduce the same result and waste an LLM pass. A real code change
      // is a different commit (so it still analyzes), and a never-analyzed commit reads
      // null (also analyzes).
      const analyzedCommit = (await readLatest(req.repoFullName))?.analysis.commitHash;
      if (analyzedCommit === req.commitSha) {
        log.info(
          `[github-app] Code Quality analyze skipped for ${req.repoFullName}@${req.commitSha.slice(0, 7)} — code already analyzed`,
        );
      } else {
        await deps.onPhase?.('analyze');
        // LLM (semantic) rules run only when the workspace opted in; deterministic
        // rules always run. They use the AI SDK transport's structured-output path.
        await analyzeInProcess(
          { slug: req.repoFullName, name: req.repoFullName, path: req.repoFullName },
          { codeDir: tmp, skipStash: true, enableLlmRulesOverride: req.enableLlmAnalysis ?? false },
        );
      }
    } catch (err) {
      log.warn(
        `[github-app] baseline analyze failed for ${req.repoFullName}@${req.commitSha.slice(0, 7)}: ${(err as Error).message}`,
      );
    }

    await deps.store.saveBaseline({
      repoFullName: req.repoFullName,
      commitSha: req.commitSha,
      capturedAt: new Date().toISOString(),
    });
    log.info(`[github-app] baseline saved for ${req.repoFullName}@${req.commitSha.slice(0, 7)}`);
    return { openConflicts };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
