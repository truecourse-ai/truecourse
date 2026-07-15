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
  getGuardStore,
  readGuardDecisions as readStoredGuardDecisions,
  type GuardStore,
  type RepoRef,
} from '@truecourse/core/lib/guard-store';
import {
  guardGenerateInProcess,
  buildGuardReport,
  buildOpenConflictsReport,
  OpenConflictsError,
  type GuardGenerateInProcessResult,
} from '@truecourse/core/commands/guard-in-process';
import { materializeWorkspaceInheritance, EMPTY_DECISIONS } from '@truecourse/core/commands/spec-in-process';
import { mergeGuardDecisions, prGuardDecisionsRef } from '@truecourse/core/commands/guard-read';
import { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '@truecourse/shared/llm';
import type { GuardGenerateReport } from '@truecourse/shared';
import type { StepTracker } from '@truecourse/core/progress';
import { corpusFilePath, decisionsPath, type DecisionsFile } from '@truecourse/spec-consolidator';
import {
  scenariosDir,
  guardDecisionsPath,
  readGuardResult as readCloneGuardResult,
} from '@truecourse/guard-runner';
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
  /**
   * Open spec conflicts that BLOCKED generation (the gate fired) — 0 on every
   * normal path. Non-zero means a blocked `open-conflicts` report was persisted
   * and NO scenario set was saved: a needs-attention outcome, not a failure (the
   * run resolves). The user resolves the conflicts, then generate re-fires.
   */
  openConflicts: number;
}

/** What the pipeline needs from the GitHub App (clone auth). */
export interface GuardOnboardingDeps {
  auth: GithubAuth;
}

/** Progress + cancellation wiring for the EE job popup. */
export interface GuardOnboardingProgress {
  /** Coarse phase callback — advances the job's stepped checklist. */
  onPhase?: (phase: 'clone' | 'generate') => void | Promise<void>;
  /** Driven through GUARD_GENERATE_STEPS for the "Generating scenarios" detail. */
  generateTracker?: StepTracker;
  /** External cancellation (graphile's per-job abort on worker shutdown) — folded
   *  with the clone wall-clock and threaded into the clone's git children. */
  signal?: AbortSignal;
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

  // Materialize the stored decisions alongside the corpus. Load-bearing twice: the
  // generate conflict gate reads `decisions.json` (a resolved conflict must travel
  // with the corpus it resolves, else the gate re-fires on the checkout), and the
  // generator's losing-side claim suppression reads the same file. Absent when the
  // repo has no stored resolutions — the checkout simply has none.
  const storedDecisions =
    (await loadSpec<DecisionsFile>(ref, 'decisions')) ??
    (await loadLatestSpec<DecisionsFile>(ref.repoKey, 'decisions'));

  // Fold the workspace Knowledge layer into the checkout too (hosted): the stored
  // corpus references inherited `knowledge/<kind>/<id>.md` docs whose bodies the
  // generator reads from disk, and the conflict gate must see the workspace
  // decisions merged UNDER the repo's own (repo wins). Inert in OSS / no workspace.
  const { decisions, inherited } = await materializeWorkspaceInheritance(
    checkoutDir,
    ref.repoKey,
    storedDecisions ?? EMPTY_DECISIONS,
  );
  if (storedDecisions != null || inherited) {
    const decFile = decisionsPath(checkoutDir);
    fs.mkdirSync(path.dirname(decFile), { recursive: true });
    fs.writeFileSync(decFile, JSON.stringify(decisions, null, 2) + '\n');
  }
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
    /**
     * Regenerating a PR head: merge that PR's guard-decisions overlay
     * (`_pr/<n>`) over the repo row when materializing dismissals — the
     * generate-side analog of the gate's `foldDismissals`. Without it a
     * PR-scoped dismissal never suppresses its claim in the regenerated corpus
     * and the held section stays held. Absent on repo-scope generates.
     */
    pr?: number;
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

  // Materialize the stored GUARD decisions (dismissedClaims) too — on every
  // path, including `skipMaterialize` (a dismissal applies regardless of where
  // the corpus came from). The dashboard dismisses claims into the hosted guard
  // store, but the generator reads the checkout's `scenarios/decisions.json`
  // (file-based by design — it is committable), so without this a hosted
  // regenerate re-authors every dismissed claim and its section stays held.
  // Stored decisions win over a (stale) committed file; a repo with none stored
  // keeps whatever the clone carries. A PR-head regen (`opts.pr`) folds the PR's
  // dismissals overlay over the repo row — same merge the gate's foldDismissals
  // applies — so PR-scoped dismissals suppress their claims too.
  const repoGuardDecisions = await readStoredGuardDecisions(ref.repoKey);
  const guardDecisions =
    opts.pr === undefined
      ? repoGuardDecisions
      : mergeGuardDecisions(
          repoGuardDecisions,
          await readStoredGuardDecisions(ref.repoKey, prGuardDecisionsRef(opts.pr)),
        );
  if (guardDecisions.dismissedClaims.length > 0) {
    const decFile = guardDecisionsPath(checkoutDir);
    fs.mkdirSync(path.dirname(decFile), { recursive: true });
    fs.writeFileSync(decFile, JSON.stringify(guardDecisions, null, 2) + '\n');
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

/**
 * Read an evidence dir out of a checkout as `{ fileName: body }`, or `null` when
 * the dir is missing or holds no regular files (nothing transcribed). Shared by
 * the gate's `persistFailureEvidence` and the generate jobs' `persistBirthEvidence`.
 */
export function collectEvidenceFiles(
  checkoutDir: string,
  evidencePath: string,
): Record<string, string> | null {
  const dir = path.join(checkoutDir, evidencePath);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const files: Record<string, string> = {};
  for (const name of names) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isFile()) files[name] = fs.readFileSync(file, 'utf-8');
  }
  return Object.keys(files).length > 0 ? files : null;
}

/**
 * Copy each birth finding's transcript out of the checkout into the guard store
 * before the (ephemeral) checkout is removed — the generate-jobs analogue of the
 * gate's `persistFailureEvidence`. A birth run is `persist: false` (no run row), so
 * its evidence attaches to the generate report at `ref`'s commit; the report row must
 * already be persisted. The finding's `evidencePath` is the sanitized
 * `.truecourse/guard/evidence/<runId>/<scenarioSeg>` dir, so the scenario segment is
 * its basename. The OSS file store no-ops (its evidence is already on disk).
 */
export async function persistBirthEvidence(
  guardStore: GuardStore,
  ref: RepoRef,
  checkoutDir: string,
  report: GuardGenerateReport,
): Promise<void> {
  for (const finding of report.birthFindings) {
    if (!finding.evidencePath) continue;
    const files = collectEvidenceFiles(checkoutDir, finding.evidencePath);
    if (!files) continue;
    const scenarioSeg = finding.evidencePath.split('/').pop()!;
    await guardStore.writeGuardResultEvidence(ref, scenarioSeg, files);
  }
}

/** The injectable heavy steps (network + LLM); production uses the defaults. */
export interface GuardOnboardingSeams {
  /** Shallow-clone the repo pinned to `req.commitSha` into `dir`. `deps.signal`
   *  is the pipeline's clone-phase bound (the wall-clock folded with the job's
   *  cancellation signal) — every git child must run under it. */
  cloneRepo?: (
    deps: GuardOnboardingDeps & { signal?: AbortSignal },
    req: GuardOnboardingRequest,
    dir: string,
  ) => Promise<void>;
  /** The in-process guard generate over the checkout. */
  generate?: GuardGenerateFn;
  /** Test seam: clone-phase wall-clock override (default {@link GUARD_CLONE_TIMEOUT_MS}). */
  cloneTimeoutMs?: number;
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

/** Clone-phase wall-clock, mirroring the gate's `GUARD_GATE_CLONE_TIMEOUT_MS`
 *  (guard-gate-runner.ts — deliberately NOT imported: that module imports this
 *  one, and the constant is not worth a cycle). A hung remote must fail the job,
 *  not occupy one of the worker's two concurrency slots until restart. */
export const GUARD_CLONE_TIMEOUT_MS = 5 * 60_000;

/**
 * The signal the clone phase runs under: the clone wall-clock folded with the
 * job's cancellation signal when one is threaded (either aborts). On abort,
 * simple-git kills the git child and rejects — the pipeline's existing failure
 * path takes it from there (the job fails; `finally` removes the checkout).
 * The gate's `cloneAbortSignal`, mirrored.
 */
export function boundedCloneSignal(
  signal?: AbortSignal,
  timeoutMs: number = GUARD_CLONE_TIMEOUT_MS,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function defaultCloneRepo(
  deps: GuardOnboardingDeps & { signal?: AbortSignal },
  req: GuardOnboardingRequest,
  dir: string,
): Promise<void> {
  await cloneRepoAtCommit(deps.auth, req, dir, deps.signal);
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
        // The clone is bounded no matter which impl runs: wall-clock + the job's
        // cancellation signal, so a wedged remote can never pin a worker slot.
        await cloneRepo(
          { ...deps, signal: boundedCloneSignal(progress.signal, seams.cloneTimeoutMs) },
          req,
          tmp,
        );

        let generated;
        try {
          generated = await materializeAndGenerateGuard(ref, tmp, generate, {
            onGenerateStart: () => progress.onPhase?.('generate'),
            tracker: progress.generateTracker,
          });
        } catch (e) {
          // The generate gate hard-fails on unresolved spec conflicts. Persist a
          // blocked `open-conflicts` report (NO scenario set) and RESOLVE — a
          // needs-attention outcome, not a failure. The user resolves the conflicts,
          // then generate re-fires.
          if (e instanceof OpenConflictsError) {
            await writeGuardResult(ref, buildOpenConflictsReport(e, new Date().toISOString()));
            return {
              savedFileCount: 0,
              scenariosWritten: 0,
              noCorpus: false,
              openConflicts: e.conflicts.length,
            };
          }
          throw e;
        }
        // No curated corpus / no docs → clean no-op: scenarios arrive once the
        // spec is scanned (the onboarding chain re-fires after the next baseline).
        if (!generated) {
          return { savedFileCount: 0, scenariosWritten: 0, noCorpus: true, openConflicts: 0 };
        }

        // Persist the scenario tree the generate wrote into the clone, then the
        // report, then copy any birth-finding transcripts out before the clone goes.
        const { fileCount } = await saveScenarios(ref, scenariosDir(tmp));
        await writeGuardResult(ref, generated.report);
        await persistBirthEvidence(getGuardStore(), ref, tmp, generated.report);

        return {
          savedFileCount: fileCount,
          scenariosWritten: generated.guard.written.length,
          noCorpus: false,
          openConflicts: 0,
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
