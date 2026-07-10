/**
 * Guard onboarding: generate a connected repo's guard scenarios server-side and
 * persist them to the hosted guard store — the guard analogue of `spec-scan.ts`.
 *
 * The pipeline shallow-clones the repo pinned at the request's commit, materializes the
 * Pg-STORED curated corpus (`specs/corpus.json`, produced by the baseline's spec
 * scan) into the checkout — the generator's only doc authority — then runs the
 * shared in-process guard generate (LLM stages through the process-global EE
 * transport; birth-validation through the guard executor seam) and persists the
 * resulting scenario corpus (`recipe.json` + `manifest.json` + `*.yaml`) plus the
 * generate report to the guard store keyed by `(owner/repo, commit)`.
 *
 * A repo with no curated corpus (none stored, none committed) is a CLEAN no-op
 * (`noCorpus: true`) — scenarios generate once the spec is scanned. The heavy
 * steps (clone, generate) are injectable defaults so tests exercise the real
 * pipeline body without a network or an LLM.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { loadSpec, loadLatestSpec } from '@truecourse/core/lib/spec-store';
import {
  saveScenarios,
  writeGuardResult,
  type RepoRef,
} from '@truecourse/core/lib/guard-store';
import {
  guardGenerateInProcess,
  buildGuardReport,
  type GuardGenerateInProcessResult,
} from '@truecourse/core/commands/guard-in-process';
import { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '@truecourse/shared/llm';
import type { GuardGenerateReport } from '@truecourse/shared';
import type { StepTracker } from '@truecourse/core/progress';
import { corpusFilePath } from '@truecourse/spec-consolidator';
import { scenariosDir, readGuardResult as readCloneGuardResult } from '@truecourse/guard-runner';
import { hasGuardUniverse, type GuardGenerateResult } from '@truecourse/guard-generator';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';

export interface GuardOnboardingRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  /** Default-branch head — everything persists under it. */
  commitSha: string;
}

export interface GuardOnboardingResult {
  /** Scenario-corpus files persisted (`recipe.json` + `manifest.json` + `*.yaml`). */
  savedFileCount: number;
  /** Scenarios written by the generate (passed birth-validation and settled). */
  scenariosWritten: number;
  /** No curated corpus (stored or committed) → clean no-op success. */
  noCorpus: boolean;
}

/** What the pipeline needs from the GitHub App (clone auth). */
export interface GuardOnboardingDeps {
  auth: GithubAuth;
}

/** Progress wiring for the EE job popup. */
export interface GuardOnboardingProgress {
  /** Coarse phase callback — advances the job's stepped checklist. */
  onPhase?: (phase: 'clone' | 'generate') => void | Promise<void>;
  /** Driven through GUARD_GENERATE_STEPS for the "Generating scenarios" detail. */
  generateTracker?: StepTracker;
}

export interface GuardOnboardingPipeline {
  run(
    deps: GuardOnboardingDeps,
    req: GuardOnboardingRequest,
    progress?: GuardOnboardingProgress,
  ): Promise<GuardOnboardingResult>;
}

/**
 * Write the Pg-stored curated corpus for `ref` into
 * `<checkout>/.truecourse/specs/corpus.json` — exactly where the guard
 * generator's section plan reads its doc universe (`corpusFilePath`). Returns
 * false when no corpus is stored for the repo at all (the caller decides the
 * no-op). The exact-commit read is preferred, but the spec corpus is keyed by
 * the SCAN-TIME default-branch commit — the gate's cold path arrives with the
 * PR's base tip, which may have advanced past it inside the onboarding window —
 * so a miss falls back to the repo's LATEST stored corpus rather than treating
 * a scanned repo as unspecced.
 */
export async function materializeStoredCorpus(ref: RepoRef, checkoutDir: string): Promise<boolean> {
  const corpus =
    (await loadSpec(ref, 'corpus')) ?? (await loadLatestSpec(ref.repoKey, 'corpus'));
  if (corpus == null) return false;
  const file = corpusFilePath(checkoutDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(corpus, null, 2) + '\n');
  return true;
}

/** The in-process guard generate over a checkout — the injectable LLM step. */
export type GuardGenerateFn = (
  checkoutDir: string,
  tracker?: StepTracker,
) => Promise<GuardGenerateInProcessResult>;

/** A successful materialize + generate: the ok generator result plus the report
 *  to persist (the clone's file report when present — it carries usage totals). */
export interface GuardGeneratedCorpus {
  guard: GuardGenerateResult;
  report: GuardGenerateReport;
}

/**
 * Materialize the stored (or committed) curated corpus into `checkoutDir` and run
 * the in-process guard generate over it — the shared core of BOTH the onboarding
 * job and the gate's cold-generate path (persistence stays with each caller, which
 * key their stores differently). Returns `null` when there is no curated corpus /
 * no doc universe / no docs (a clean no-op → the caller's neutral); THROWS on a
 * generation failure or a missing LLM provider (never collapses to a no-op — the
 * gate turns that into its error Check). Does not clone and does not persist.
 */
export async function materializeAndGenerateGuard(
  ref: RepoRef,
  checkoutDir: string,
  generate: GuardGenerateFn,
  opts: {
    onGenerateStart?: () => void | Promise<void>;
    tracker?: StepTracker;
    /**
     * Skip materializing the Pg-stored corpus — the caller already put a fresh
     * `corpus.json` in the checkout (the spec-change regen curates the head's own
     * specs, which must NOT be overwritten by the stale stored corpus). Still
     * no-ops when the checkout has no doc universe.
     */
    skipMaterialize?: boolean;
  } = {},
): Promise<GuardGeneratedCorpus | null> {
  // The corpus is generation's only doc authority. Prefer the one stored for this
  // ref; a repo that COMMITS its corpus (it is committable) already carries one in
  // the clone. Neither, and no in-tree doc universe → clean no-op.
  if (!opts.skipMaterialize) {
    const materialized = await materializeStoredCorpus(ref, checkoutDir);
    if (!materialized && !hasGuardUniverse(checkoutDir)) return null;
  } else if (!hasGuardUniverse(checkoutDir)) {
    return null;
  }

  // Fail loudly BEFORE any LLM work when no provider is configured — EE must never
  // fall back to the `claude` CLI (same rule as spec-scan / onboarding).
  if (!isLlmConfigured()) throw new Error(NO_LLM_PROVIDER_MESSAGE);

  await opts.onGenerateStart?.();
  const { guard } = await generate(checkoutDir, opts.tracker);

  // An empty doc universe generates nothing — same user story as no corpus.
  if (guard.status === 'no-docs') return null;
  if (guard.status !== 'ok') {
    throw new Error(guard.reason ?? `guard generation failed (${guard.status})`);
  }
  // Prefer the clone's file report (it carries the usage totals the in-process
  // driver stamped) over rebuilding from the result.
  const report =
    readCloneGuardResult(checkoutDir) ?? buildGuardReport(guard, new Date().toISOString());
  return { guard, report };
}

/** The injectable heavy steps (network + LLM); production uses the defaults. */
export interface GuardOnboardingSeams {
  /** Shallow-clone the repo pinned to `req.commitSha` into `dir`. */
  cloneRepo?: (
    deps: GuardOnboardingDeps,
    req: GuardOnboardingRequest,
    dir: string,
  ) => Promise<void>;
  /** The in-process guard generate over the checkout. */
  generate?: GuardGenerateFn;
}

/**
 * Shallow-clone `req.repoFullName`'s default branch into `dir`, then pin the
 * checkout to `req.commitSha` (fetching it if the branch head has moved). The
 * plain "clone the default branch at a commit" step shared by the onboarding
 * generate and the guard-baseline refresh (issue 06) — both persist scenarios /
 * run results keyed to that exact commit, so the tree must be pinned to it. The
 * optional `signal` aborts the git children (worker shutdown / cancellation).
 */
export async function cloneRepoAtCommit(
  auth: GithubAuth,
  req: { repoFullName: string; installationId: number; defaultBranch: string; commitSha: string },
  dir: string,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getInstallationToken(auth, req.installationId);
  const authArgs = cloneAuthArgs(token);
  const cloner = signal ? simpleGit({ abort: signal }) : simpleGit();
  await cloner.clone(cloneUrl(req.repoFullName), dir, [
    ...authArgs,
    '--depth',
    '1',
    '--branch',
    req.defaultBranch,
  ]);
  const git = signal ? simpleGit(dir, { abort: signal }) : simpleGit(dir);
  // Drop the token the clone persisted into .git/config — defence in depth.
  // (Later commands pass auth args per invocation, the gate-runner convention.)
  await stripEmbeddedAuth(git);
  // Pin the checkout to the commit everything persists under: the branch head
  // may have moved since the baseline settled (or since the manual click), and
  // scenarios keyed to `commitSha` must be generated from that tree.
  const head = (await git.revparse(['HEAD'])).trim();
  if (head !== req.commitSha) {
    await git.raw([...authArgs, 'fetch', '--depth', '1', 'origin', req.commitSha]);
    await git.raw(['checkout', '-f', 'FETCH_HEAD']);
  }
}

async function defaultCloneRepo(
  deps: GuardOnboardingDeps,
  req: GuardOnboardingRequest,
  dir: string,
): Promise<void> {
  await cloneRepoAtCommit(deps.auth, req, dir);
}

export function createGuardOnboardingPipeline(
  seams: GuardOnboardingSeams = {},
): GuardOnboardingPipeline {
  const cloneRepo = seams.cloneRepo ?? defaultCloneRepo;
  const generate =
    seams.generate ??
    ((checkoutDir: string, tracker?: StepTracker) =>
      // No onLlmEstimate: there is no interactive cost gate in hosted mode. The
      // process-global EE transport + guard executor are picked up internally.
      guardGenerateInProcess(checkoutDir, { tracker }));

  return {
    async run(deps, req, progress = {}) {
      const ref: RepoRef = { repoKey: req.repoFullName, commitSha: req.commitSha };
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-guard-'));
      try {
        await progress.onPhase?.('clone');
        await cloneRepo(deps, req, tmp);

        const generated = await materializeAndGenerateGuard(ref, tmp, generate, {
          onGenerateStart: () => progress.onPhase?.('generate'),
          tracker: progress.generateTracker,
        });
        // No curated corpus / no docs → clean no-op: scenarios arrive once the
        // spec is scanned (the onboarding chain re-fires after the next baseline).
        if (!generated) {
          return { savedFileCount: 0, scenariosWritten: 0, noCorpus: true };
        }

        // Persist the scenario tree the generate wrote into the clone, then the report.
        const { fileCount } = await saveScenarios(ref, scenariosDir(tmp));
        await writeGuardResult(ref, generated.report);

        return {
          savedFileCount: fileCount,
          scenariosWritten: generated.guard.written.length,
          noCorpus: false,
        };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

/** The production pipeline (real shallow clone + real in-process generate). */
export const defaultGuardOnboardingPipeline: GuardOnboardingPipeline =
  createGuardOnboardingPipeline();
