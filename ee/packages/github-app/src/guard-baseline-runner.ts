/**
 * Guard-baseline pipeline: the durable `guard.baseline` job's body. Refreshes a
 * connected repo's guard baseline (the diff gate's "current main" comparison
 * point) by running the COMMITTED scenario corpus against the default branch and
 * persisting the result as the repo's guard LATEST — so the next PR gate diffs
 * against a warm baseline instead of paying a lazy base run.
 *
 * It is the base-run half of the gate pipeline, standalone: clone the default
 * branch pinned at `commitSha`, load the committed corpus, run it through the
 * `GuardExecutor` under the SHARED gate concurrency limiter, and `writeGuardLatest`.
 * NO diff, NO Check, NO PR head checkout. The heavy seams (clone, corpus load) are
 * injectable so tests drive the real body with fakes + a PGlite guard store.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GuardStore, RepoRef } from '@truecourse/core/lib/guard-store';
import type { GuardExecReport, GuardExecutor } from '@truecourse/guard-runner';
import { boundedCloneSignal, cloneRepoAtCommit } from './guard-onboarding.js';
import type { GithubAuth } from '@truecourse/github-app';
import {
  defaultLoadCorpus,
  GUARD_GATE_RUN_TIMEOUT_MS,
  GUARD_GATE_BUILD_TIMEOUT_MS,
  type GuardGateCorpus,
  type GuardGateLimiter,
} from './guard-gate-runner.js';

/** The resolved refresh target — `GuardBaselineJobPayload` minus the job envelope. */
export interface GuardBaselineRunRequest {
  repoFullName: string;
  installationId: number;
  workspaceOrgId: string;
  defaultBranch: string;
  /** Default-branch head to run against — the baseline is stamped with it. */
  commitSha: string;
}

/** What the baseline job body hands the pipeline (mirrors the gate's deps, minus
 *  the gate/octokit surfaces — there is no Check to post and no PR to resolve). */
export interface GuardBaselinePipelineDeps {
  guardStore: GuardStore;
  auth: GithubAuth;
  execute: GuardExecutor;
  /** SHARED with the gate — one process-wide permit pool caps concurrent executor runs. */
  limiter: GuardGateLimiter;
}

export type GuardBaselinePhase = 'clone' | 'run' | 'persist';

export interface GuardBaselineRunOptions {
  onPhase?: (p: GuardBaselinePhase) => void | Promise<void>;
  signal?: AbortSignal;
}

/**
 * The refresh outcome:
 *  - `ok`        — the corpus ran and the baseline LATEST was written.
 *  - `no-corpus` — no committed scenarios for the repo (nothing to run; the gate
 *                  keeps its no-scenarios neutral). A clean no-op success.
 *  - `no-verdict`— the executor produced no ok report (build/run error); the old
 *                  baseline is left untouched and the job reports it.
 */
export interface GuardBaselineResult {
  status: 'ok' | 'no-corpus' | 'no-verdict';
  scenarioCount: number;
}

/** Shallow-clone the default branch pinned at `commitSha` into `dir`. */
export type GuardBaselineClone = (
  deps: { auth: GithubAuth; signal?: AbortSignal },
  req: GuardBaselineRunRequest,
  dir: string,
) => Promise<void>;

/** Injectable heavy seams (network + corpus read). */
export interface GuardBaselinePipelineSeams {
  clone?: GuardBaselineClone;
  /** Load the committed corpus for `ref` (`null` → no corpus). Default = the store. */
  loadCorpus?: (ref: RepoRef, dir: string) => Promise<GuardGateCorpus | null>;
  /** Test seam: clone-phase wall-clock override (default the gate's 5-minute bound). */
  cloneTimeoutMs?: number;
}

export interface GuardBaselinePipeline {
  run(
    deps: GuardBaselinePipelineDeps,
    req: GuardBaselineRunRequest,
    opts?: GuardBaselineRunOptions,
  ): Promise<GuardBaselineResult>;
}

const defaultClone: GuardBaselineClone = ({ auth, signal }, req, dir) =>
  cloneRepoAtCommit(auth, req, dir, signal);

export function createGuardBaselinePipeline(
  seams: GuardBaselinePipelineSeams = {},
): GuardBaselinePipeline {
  const clone = seams.clone ?? defaultClone;

  return {
    async run(deps, req, opts = {}) {
      const repoKey = req.repoFullName;
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-baseline-'));
      try {
        await opts.onPhase?.('clone');
        // The clone is bounded no matter which impl runs: wall-clock folded with
        // the job's cancellation signal (either aborts the git children), so a
        // wedged remote can never pin one of the worker's concurrency slots.
        await clone(
          { auth: deps.auth, signal: boundedCloneSignal(opts.signal, seams.cloneTimeoutMs) },
          req,
          tmp,
        );

        // The corpus keyed by this commit (falling back to the newest stored set,
        // via defaultLoadCorpus) — the SAME committed corpus the gate runs.
        const ref: RepoRef = { repoKey, commitSha: req.commitSha };
        const corpus = seams.loadCorpus
          ? await seams.loadCorpus(ref, tmp)
          : await defaultLoadCorpus(deps.guardStore, ref);
        if (corpus === null || corpus.scenarios.length === 0) {
          return { status: 'no-corpus', scenarioCount: corpus?.scenarios.length ?? 0 };
        }

        await opts.onPhase?.('run');
        const { recipe, scenarios } = corpus;
        const report: GuardExecReport = await deps.limiter.run(() =>
          deps.execute({
            checkoutDir: tmp,
            recipe,
            scenarios,
            branch: req.defaultBranch,
            commit: req.commitSha,
            persist: false,
            runTimeoutMs: GUARD_GATE_RUN_TIMEOUT_MS,
            buildTimeoutMs: GUARD_GATE_BUILD_TIMEOUT_MS,
            signal: opts.signal,
          }),
        );
        // A build/run error leaves the previous baseline in place — better a stale
        // baseline than a wiped one — and surfaces as `no-verdict` for the job.
        if (report.status !== 'ok') {
          return { status: 'no-verdict', scenarioCount: scenarios.length };
        }

        await opts.onPhase?.('persist');
        await deps.guardStore.writeGuardLatest(repoKey, report.latest);
        return { status: 'ok', scenarioCount: scenarios.length };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

/** The production pipeline (real clone + store-backed corpus load). */
export const defaultGuardBaselinePipeline: GuardBaselinePipeline = createGuardBaselinePipeline();
