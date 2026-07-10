/**
 * Guard head-regen: regenerate a PR head's guard scenarios server-side after a
 * writer ticks the spec-change checkbox. Unlike the onboarding pipeline (which
 * materializes the repo's already-scanned baseline corpus), this re-scans the PR
 * HEAD's own — possibly just-edited — spec docs into a fresh corpus, generates
 * scenarios from it, and persists them under the head commit so the re-gate runs
 * the PR's updated scenarios. Fork-safe: the head is fetched via the base repo's
 * pull ref, so the fork remote is never touched.
 *
 * The heavy steps (clone, curate-scan, LLM generate) are injectable defaults so
 * tests exercise the real pipeline body without a network or an LLM.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { getGuardStore, type GuardStore, type RepoRef } from '@truecourse/core/lib/guard-store';
import { guardGenerateInProcess } from '@truecourse/core/commands/guard-in-process';
import type { StepTracker } from '@truecourse/core/progress';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';
import { materializeAndGenerateGuard, type GuardGenerateFn } from './guard-onboarding.js';
import { defaultSpecScanPipeline } from './spec-scan.js';
import {
  persistGeneratedGuardCorpus,
  cloneAbortSignal,
  type GuardGateCorpus,
} from './guard-gate-runner.js';

/** What the head-regen needs to fetch + check out the PR head (fork-safe pull ref). */
export interface GuardHeadRegenRequest {
  repoFullName: string;
  installationId: number;
  prNumber: number;
  /** The PR's base branch — the clone's starting tree (the pull ref lives here). */
  baseBranch: string;
  /** The PR head commit — scenarios persist under it. */
  headSha: string;
}

export interface GuardHeadRegenResult {
  /** Scenarios written by the regenerate (passed birth-validation and settled). */
  scenariosWritten: number;
  /** No doc universe after the head scan → clean no-op (no corpus, no re-gate). */
  noCorpus: boolean;
  /** The freshly parsed corpus for the re-gate's loadCorpus seam (null when noCorpus). */
  corpus: GuardGateCorpus | null;
}

export interface GuardHeadRegenDeps {
  auth: GithubAuth;
}

export interface GuardHeadRegenProgress {
  onPhase?: (phase: 'clone' | 'scan' | 'generate') => void | Promise<void>;
  scanTracker?: StepTracker;
  generateTracker?: StepTracker;
}

export interface GuardHeadRegenSeams {
  /** Shallow-clone the base branch, fetch `refs/pull/<n>/head`, check out `req.headSha`. */
  clone?: (deps: GuardHeadRegenDeps, req: GuardHeadRegenRequest, dir: string) => Promise<void>;
  /** Curate the head's spec docs into `<dir>/.truecourse/specs/corpus.json` (+ persist under `ref`). */
  scan?: (dir: string, ref: RepoRef, tracker?: StepTracker) => Promise<void>;
  /** The in-process guard generate over the checkout. */
  generate?: GuardGenerateFn;
  /** Where the regenerated corpus persists (default: the process-global store). */
  guardStore?: GuardStore;
}

export interface GuardHeadRegenPipeline {
  run(
    deps: GuardHeadRegenDeps,
    req: GuardHeadRegenRequest,
    progress?: GuardHeadRegenProgress,
  ): Promise<GuardHeadRegenResult>;
}

/**
 * Pin the checkout to the ENQUEUE-TIME head, not whatever the pull ref points at
 * by the time the durable job runs: scenarios persist under `headSha` and the
 * re-gate checks out `headSha`, so generating from a newer push would key the
 * corpus to the wrong commit (and strand the re-gate's checkout). When the ref
 * has moved past `headSha`, the commit is fetched by sha — the same recovery
 * `guard-onboarding.ts` uses for a moved default branch.
 */
export async function checkoutPinnedHead(
  dir: string,
  authArgs: string[],
  headSha: string,
  signal?: AbortSignal,
): Promise<void> {
  const git = simpleGit(dir, { abort: signal ?? cloneAbortSignal() });
  const fetched = (await git.revparse(['FETCH_HEAD'])).trim();
  if (fetched !== headSha) {
    await git.raw([...authArgs, 'fetch', '--depth', '1', 'origin', headSha]);
  }
  await git.raw(['checkout', '-f', headSha]);
}

/** Fork-safe clone: shallow-clone the base branch, fetch the PR head via the base
 *  repo's pull ref (fork PRs never touch the fork remote), and pin the checkout
 *  to the enqueue-time `req.headSha` (see {@link checkoutPinnedHead}). */
const defaultClone = async (
  deps: GuardHeadRegenDeps,
  req: GuardHeadRegenRequest,
  dir: string,
): Promise<void> => {
  const abort = cloneAbortSignal();
  const token = await getInstallationToken(deps.auth, req.installationId);
  const authArgs = cloneAuthArgs(token);
  await simpleGit({ abort }).clone(cloneUrl(req.repoFullName), dir, [
    ...authArgs,
    '--depth',
    '1',
    '--branch',
    req.baseBranch,
  ]);
  const git = simpleGit(dir, { abort });
  await stripEmbeddedAuth(git);
  await git.raw([...authArgs, 'fetch', '--depth', '1', 'origin', `refs/pull/${req.prNumber}/head`]);
  await checkoutPinnedHead(dir, authArgs, req.headSha, abort);
};

/** Default scan: reuse the spec-scan pipeline's curate step (guard's upstream) to
 *  re-scan the head's docs into `corpus.json` and persist it under `ref`. */
const defaultScan = async (dir: string, ref: RepoRef, tracker?: StepTracker): Promise<void> => {
  await defaultSpecScanPipeline.scan(dir, ref, tracker);
};

export function createGuardHeadRegenPipeline(seams: GuardHeadRegenSeams = {}): GuardHeadRegenPipeline {
  const clone = seams.clone ?? defaultClone;
  const scan = seams.scan ?? defaultScan;
  const generate =
    seams.generate ?? ((checkoutDir, tracker) => guardGenerateInProcess(checkoutDir, { tracker }));
  // Read at run time (not creation time) so a store installed after the pipeline
  // module loads — the EE boot order — is still honored.
  const guardStore = () => seams.guardStore ?? getGuardStore();

  return {
    async run(deps, req, progress = {}) {
      const ref: RepoRef = { repoKey: req.repoFullName, commitSha: req.headSha };
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-head-regen-'));
      try {
        await progress.onPhase?.('clone');
        await clone(deps, req, tmp);

        // Re-scan the HEAD's own spec docs into a fresh corpus (the PR may have
        // just edited them) — NOT the stale stored baseline corpus.
        await progress.onPhase?.('scan');
        await scan(tmp, ref, progress.scanTracker);

        const generated = await materializeAndGenerateGuard(ref, tmp, generate, {
          skipMaterialize: true, // the scan just wrote the head's fresh corpus.json
          onGenerateStart: () => progress.onPhase?.('generate'),
          tracker: progress.generateTracker,
        });
        if (!generated) return { scenariosWritten: 0, noCorpus: true, corpus: null };

        // Persist under the head + read the corpus back through the store for
        // the re-gate (the shared cold-generate persistence path).
        const corpus = await persistGeneratedGuardCorpus(guardStore(), ref, tmp, generated.report);
        return { scenariosWritten: generated.guard.written.length, noCorpus: false, corpus };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

/** The production head-regen pipeline (real fork-safe clone + curate + generate). */
export const defaultGuardHeadRegenPipeline: GuardHeadRegenPipeline = createGuardHeadRegenPipeline();
