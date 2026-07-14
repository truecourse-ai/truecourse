/**
 * Gate check runner: clone the PR's base branch, fetch + check out the PR head
 * via `refs/pull/<n>/head` (which lives in the base repo, so this works for fork
 * PRs too), then run the OSS analyze pass on the head to produce the Code Quality
 * signal (new violations vs the repo's baseline analysis). Read-only — the gate
 * never pushes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { analyzeCore } from '@truecourse/core/commands/analyze-core';
import { persistDiffAnalysis } from '@truecourse/core/commands/analyze-persist';
import { log } from '@truecourse/core/lib/logger';
import type { ViolationRecord } from '@truecourse/core/types/snapshot';
import type { GateStore } from './store/types.js';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';

export interface GateVerifyDeps {
  store: GateStore;
  auth: GithubAuth;
}

export interface GateVerifyRequest {
  repoFullName: string;
  installationId: number;
  prNumber: number;
  /** The PR's actual base ref. */
  baseBranch: string;
  /** Run the LLM (semantic) code-analysis rules; off by default — deterministic rules always run. */
  enableLlmAnalysis?: boolean;
}

export interface GateVerifyOutput {
  baseSha: string | null;
  /** The sha we actually analyzed (resolved from the pull ref). */
  headSha: string | null;
  /**
   * Code Quality signal: NEW violations the PR head introduces vs the baseline
   * analysis (analyzeCore's lifecycle `added`). `null` when there's no baseline
   * analysis to diff against (or analyze failed) — the gate then leaves the Code
   * Quality Check neutral.
   */
  codeQualityAdded: ViolationRecord[] | null;
}

export async function runGateVerify(
  deps: GateVerifyDeps,
  req: GateVerifyRequest,
): Promise<GateVerifyOutput> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-verify-'));

  try {
    const token = await getInstallationToken(deps.auth, req.installationId);
    const auth = cloneAuthArgs(token);

    await simpleGit().clone(cloneUrl(req.repoFullName), tmp, [
      ...auth,
      '--depth',
      '1',
      '--branch',
      req.baseBranch,
    ]);
    const git = simpleGit(tmp);
    await stripEmbeddedAuth(git);
    const baseSha = (await git.revparse(['HEAD'])).trim();

    // Fetch + check out the PR head (the pull ref lives in the base repo).
    await git.raw([
      ...auth,
      'fetch',
      '--depth',
      '1',
      'origin',
      `refs/pull/${req.prNumber}/head`,
    ]);
    await git.raw(['checkout', '-f', 'FETCH_HEAD']);
    const headSha = (await git.revparse(['HEAD'])).trim();

    // Code Quality signal — run the OSS analyze pass on the PR-head checkout,
    // diffed against the baseline analysis. analyzeCore is STATELESS (no persist,
    // so it never moves the repo's baseline LATEST) and its full-mode lifecycle
    // returns `added` = new violations vs the baseline. Best-effort: a failure or
    // a missing baseline yields null → the gate leaves the Code Quality Check neutral.
    let codeQualityAdded: ViolationRecord[] | null = null;
    try {
      const cq = await analyzeCore(
        { slug: req.repoFullName, name: req.repoFullName, path: req.repoFullName },
        { codeDir: tmp, mode: 'full', enableLlmRulesOverride: req.enableLlmAnalysis ?? false },
      );
      codeQualityAdded = cq.latestBaseline ? cq.pipelineResult.added : null;
      // Persist the PR head's Code Quality DIFF (new/resolved vs the baseline) under
      // a PR-scoped key, so the dashboard's PR view can show new/resolved — the
      // analyze-equivalent of OSS `?view=diff`. `writeDiff` only; the repo's baseline
      // LATEST is never touched. Skipped when there's no baseline (nothing to diff).
      if (cq.latestBaseline) {
        const prKey = `${req.repoFullName}::pr/${req.prNumber}`;
        await persistDiffAnalysis({ slug: prKey, name: req.repoFullName, path: prKey }, cq);
      }
    } catch (err) {
      log.warn(
        `[github-app] code quality analyze failed for ${req.repoFullName} PR#${req.prNumber}: ${(err as Error).message}`,
      );
    }

    return { baseSha, headSha, codeQualityAdded };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
