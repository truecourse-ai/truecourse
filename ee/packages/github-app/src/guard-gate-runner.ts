/**
 * Guard-gate pipeline: the durable `guard.gate` job's body. Clones the PR's base
 * branch (the pull ref lives in the base repo, so fork PRs gate read-only),
 * resolves the base guard results (stored baseline → exact-commit row → lazy
 * base run), executes the COMMITTED scenario corpus against the PR head through
 * the `GuardExecutor` seam under the process-wide concurrency limiter, and
 * completes the Spec Guard Check with new-failures-vs-base semantics
 * (`decideGuardGate`). Stale/orphaned bindings become inline annotations; every
 * engine-level failure posts an error-styled FAILURE Check; the deployment
 * kill-switch short-circuits to neutral before any clone.
 *
 * The heavy seams (clone / head checkout / corpus load) are injectable so tests
 * drive the real pipeline body with fakes + PGlite stores; the executor itself
 * is a dep (the `getGuardExecutor()` registry in production).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { simpleGit } from 'simple-git';
import { log } from '@truecourse/core/lib/logger';
import {
  dismissedClaimKey,
  type GuardDecisions,
  type GuardGenerateReport,
  type GuardLatest,
  type GuardScenario,
  type GuardScenarioResult,
} from '@truecourse/shared';
import type { GuardStore, RepoRef } from '@truecourse/core/lib/guard-store';
import {
  RecipeSchema,
  buildDocSectionIndex,
  loadScenarios as loadScenarioTree,
  scenariosDir,
  type DocSectionIndex,
  type GuardExecReport,
  type GuardExecutor,
  type Recipe,
} from '@truecourse/guard-runner';
import { guardGenerateInProcess } from '@truecourse/core/commands/guard-in-process';
import {
  materializeAndGenerateGuard,
  collectEvidenceFiles,
  persistBirthEvidence,
  type GuardGenerateFn,
} from './guard-onboarding.js';
import type { GateStore } from './store/types.js';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';
import { splitRepo, postCheck, type OctokitClient } from './octokit.js';
import { decideGuardGate, emptyGuardGateDiff, type GuardGateDecision } from './guard-gate.js';
import { wantsNotification } from './notifications.js';
import { prGuardUrl } from './links.js';
import type { EmailNotifier } from './email.js';
import {
  GUARD_GATE_CHECK_NAME,
  capGuardAnnotations,
  guardGateCheckOutput,
  guardGateDisabled,
  guardGateDisabledOutput,
  type GuardStaleAnnotation,
} from './guard-gate-comment.js';

/** Overall run wall-clock per executor invocation (PRD: on the order of fifteen minutes). */
export const GUARD_GATE_RUN_TIMEOUT_MS = 15 * 60_000;
/** Build wall-clock per executor invocation (PRD: on the order of ten minutes). */
export const GUARD_GATE_BUILD_TIMEOUT_MS = 10 * 60_000;
/** Clone-phase wall-clock over the default git invocations (clone/fetch/checkout) —
 *  a hung remote must fail the phase, not hang the job. A constant, deliberately
 *  not an env var: the PRD allows no new env beyond the kill switch. */
export const GUARD_GATE_CLONE_TIMEOUT_MS = 5 * 60_000;

/**
 * Signal the default git invocations run under: the clone-phase wall-clock,
 * folded with the pipeline's cancellation signal when one is threaded. On abort,
 * simple-git kills the child and rejects — the pipeline's existing catch path
 * posts the error Check and the finally removes the checkout.
 */
export function cloneAbortSignal(
  signal?: AbortSignal,
  timeoutMs: number = GUARD_GATE_CLONE_TIMEOUT_MS,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** What the gate pipeline needs to resolve + check out the PR (fork-safe pull ref). */
export interface GuardGateCheckoutRequest {
  repoFullName: string;
  installationId: number;
  /** The PR's base branch — the clone's starting tree (the lazy base run's tree). */
  baseBranch: string;
  prNumber: number;
}

/**
 * Clone seam: shallow-clone the base branch into `dir` and fetch the PR head via
 * `refs/pull/<n>/head` (which lives in the BASE repo — fork PRs never touch the
 * fork remote). The working tree is left at the BASE so a lazy base run executes
 * the right code; the pipeline advances it to the head via the `checkout` seam.
 * `deps.signal` is the pipeline's cancellation signal (the default folds it into
 * the clone-phase wall-clock via {@link cloneAbortSignal}).
 */
export type GuardGateClone = (
  deps: { auth: GithubAuth; signal?: AbortSignal },
  req: GuardGateCheckoutRequest,
  dir: string,
) => Promise<{ baseSha: string; headSha: string }>;

/** The committed scenario corpus the gate runs — recipe + parsed scenarios. */
export interface GuardGateCorpus {
  recipe: Recipe;
  scenarios: GuardScenario[];
}

/** A stored-but-unparseable recipe — a gate breakage (`invalid-recipe`), never an
 *  empty corpus. Thrown by the default corpus load; custom seams may throw it too. */
export class InvalidGuardRecipeError extends Error {}

/** Structural subset of the jobs layer's semaphore — github-app never imports ee-server. */
export interface GuardGateLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export interface GuardGatePipelineSeams {
  clone?: GuardGateClone;
  /**
   * Load the committed corpus for `ref` (`null` → no corpus at all → neutral).
   * The default reads the guard store: that commit's stored set, falling back to
   * the newest stored set. `dir` is the checkout, for impls that read in place.
   */
  loadCorpus?: (ref: RepoRef, dir: string) => Promise<GuardGateCorpus | null>;
  /** Materialize `sha`'s tree in the checkout (default `git checkout -f`,
   *  under the clone-phase wall-clock folded with `signal`). */
  checkout?: (dir: string, sha: string, signal?: AbortSignal) => Promise<void>;
  /**
   * Cold path: when {@link loadCorpus} misses (no scenarios stored ANYWHERE for
   * the repo — the first PR arrived before onboarding generation finished),
   * generate scenarios on THIS checkout (the base tree), persist them under `ref`
   * (the base commit — onboarding-that-lost-the-race), and return the freshly
   * parsed corpus to run in the same pass. `null` → a genuine absence of spec
   * docs (stays neutral). A generation failure THROWS — it must surface as the
   * gate's error Check, never collapse to neutral. The default materializes the
   * Pg-stored corpus and runs the in-process generate. Never called on the warm
   * path (a stored corpus short-circuits it), so warm repos never re-generate.
   */
  coldGenerate?: (ref: RepoRef, dir: string, signal?: AbortSignal) => Promise<GuardGateCorpus | null>;
}

export interface GuardGatePipelineDeps {
  store: GateStore;
  guardStore: GuardStore;
  auth: GithubAuth;
  octokitFor: (installationId: number) => OctokitClient;
  execute: GuardExecutor;
  /** Gates ONLY the executor calls — clone and Check posting run outside the permit. */
  limiter: GuardGateLimiter;
  /** Resend-backed email notifier; set when RESEND_API_KEY is configured, else absent (no emails). */
  notifier?: EmailNotifier;
  /** Dashboard origin for the PR-scoped guard deep link in the failure email; absent → no link. */
  appUrl?: string;
}

/** The resolved gate target — `GuardGateJobPayload` minus the job envelope. */
export interface GuardGateRunRequest {
  repoFullName: string;
  installationId: number;
  workspaceOrgId: string;
  prNumber: number;
  defaultBranch: string;
  baseBranch: string;
  baseSha: string;
  headSha: string;
  headRef: string;
  isFork: boolean;
  /** In-progress Check opened at webhook time; the pipeline completes THAT run. */
  checkRunId: number | null;
}

export type GuardGatePhase = 'clone' | 'base' | 'run' | 'verdict';

/** Per-run options: step progress + external cancellation. `signal` is threaded
 *  into every executor call (lazy base run AND head run) and the default git
 *  invocations; an aborted signal surfaces as the executor's 'aborted' report →
 *  the error-styled FAILURE Check. */
export interface GuardGateRunOptions {
  onPhase?: (p: GuardGatePhase) => void | Promise<void>;
  signal?: AbortSignal;
  /**
   * Skip the redelivery fast path (decide-from-stored-run) and re-execute the
   * head. Set by the spec-change regen re-gate: the writer deliberately wants the
   * PR's freshly-regenerated scenarios run, even though a prior gate already
   * stored a run for this head.
   */
  force?: boolean;
}

export interface GuardGatePipeline {
  run(
    deps: GuardGatePipelineDeps,
    payload: GuardGateRunRequest,
    opts?: GuardGateRunOptions,
  ): Promise<GuardGateDecision>;
}

/** Complete the gate Check as an error-styled FAILURE — the crash path (no verdict).
 *  Used by the job's catch so a thrown pipeline never strands an in-progress Check. */
export async function postGuardGateErrorCheck(
  octokit: OctokitClient,
  req: { repoFullName: string; headSha: string; checkRunId: number | null },
): Promise<void> {
  const decision: GuardGateDecision = { conclusion: 'error', diff: emptyGuardGateDiff(), errorReason: 'infra' };
  await postCheck(
    octokit,
    splitRepo(req.repoFullName),
    GUARD_GATE_CHECK_NAME,
    req.headSha,
    'failure',
    guardGateCheckOutput(decision),
    req.checkRunId,
  );
}

const defaultClone: GuardGateClone = async ({ auth, signal }, req, dir) => {
  // A hung clone/fetch must fail the phase, not hang the job: every git child in
  // this phase runs under the clone wall-clock (+ the pipeline's cancellation).
  const abort = cloneAbortSignal(signal);
  const token = await getInstallationToken(auth, req.installationId);
  const authArgs = cloneAuthArgs(token);
  await simpleGit({ abort }).clone(cloneUrl(req.repoFullName), dir, [
    ...authArgs,
    '--depth',
    '1',
    '--branch',
    req.baseBranch,
  ]);
  const git = simpleGit(dir, { abort });
  // Drop the token the clone persisted into .git/config — defence in depth
  // (later commands pass auth args per invocation, the gate-runner convention).
  await stripEmbeddedAuth(git);
  const baseSha = (await git.revparse(['HEAD'])).trim();
  await git.raw([...authArgs, 'fetch', '--depth', '1', 'origin', `refs/pull/${req.prNumber}/head`]);
  const headSha = (await git.revparse(['FETCH_HEAD'])).trim();
  // Tree deliberately left at the BASE — see {@link GuardGateClone}.
  return { baseSha, headSha };
};

const defaultCheckout = async (dir: string, sha: string, signal?: AbortSignal): Promise<void> => {
  await simpleGit(dir, { abort: cloneAbortSignal(signal) }).raw(['checkout', '-f', sha]);
};

/**
 * Default corpus load, from the guard store. The recipe and scenario set are
 * read for the ref's commit when one is known (the repo's baseline — where the
 * onboarding generate persisted them), falling back to the NEWEST stored set: a
 * default-branch re-baseline moves the baseline commit without regenerating
 * scenarios (refresh-on-merge is issue 06), and the gate must keep running the
 * last committed corpus rather than silently going neutral.
 */
export async function defaultLoadCorpus(
  guardStore: GuardStore,
  ref: RepoRef,
): Promise<GuardGateCorpus | null> {
  let raw = ref.commitSha ? await guardStore.readRecipeRaw(ref.repoKey, ref.commitSha) : null;
  if (raw == null) raw = await guardStore.readRecipeRaw(ref.repoKey);
  if (raw == null) return null;
  let recipe: Recipe;
  try {
    recipe = RecipeSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new InvalidGuardRecipeError(
      `invalid committed recipe for ${ref.repoKey}: ${(err as Error).message}`,
    );
  }
  let scenarios: GuardScenario[] = [];
  if (ref.commitSha) scenarios = (await guardStore.loadScenarios(ref)).scenarios;
  if (scenarios.length === 0) scenarios = await loadLatestScenarios(guardStore, ref.repoKey);
  return { recipe, scenarios };
}

/** The newest stored scenario set, via the commit-optional browse reads (which
 *  fall back to latest), materialized for the unchanged guard-runner loader. */
async function loadLatestScenarios(
  guardStore: GuardStore,
  repoKey: string,
): Promise<GuardScenario[]> {
  const rels = await guardStore.listScenarioFiles(repoKey);
  if (rels.length === 0) return [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-gate-corpus-'));
  try {
    for (const rel of rels) {
      if (rel.split('/').includes('..')) continue;
      const body = await guardStore.readScenarioFile(repoKey, rel);
      if (body == null) continue;
      const dest = path.join(root, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
    }
    return loadScenarioTree(root).scenarios;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Persist a freshly generated scenario corpus + report under `ref` (via the
 * given guard store, so tests key their PGlite store not the process-global
 * one), then read the corpus back THROUGH the store so the same parse +
 * recipe-validation path (and InvalidGuardRecipeError contract) applies.
 * Shared by the gate's cold-generate and the spec-change head-regen. Birth
 * findings' transcripts are copied out here too (the report row they hang off
 * was just written), so every caller persists evidence before the checkout goes.
 */
export async function persistGeneratedGuardCorpus(
  guardStore: GuardStore,
  ref: RepoRef,
  checkoutDir: string,
  report: GuardGenerateReport,
): Promise<GuardGateCorpus | null> {
  await guardStore.saveScenarios(ref, scenariosDir(checkoutDir));
  await guardStore.writeGuardResult(ref, report);
  await persistBirthEvidence(guardStore, ref, checkoutDir, report);
  return defaultLoadCorpus(guardStore, ref);
}

/**
 * Default cold-generate: materialize the Pg-stored curated corpus into the gate
 * checkout, run the in-process guard generate over it, persist the resulting
 * scenario corpus + report under `ref`, and return the freshly parsed corpus.
 * `null` → no curated corpus / no docs (neutral); a generation failure
 * PROPAGATES (never neutral). Mirrors the onboarding job's body minus the
 * clone the gate already did — the two share {@link materializeAndGenerateGuard}.
 */
export async function defaultGuardColdGenerate(
  guardStore: GuardStore,
  ref: RepoRef,
  dir: string,
  generate: GuardGenerateFn = (checkoutDir, tracker) =>
    guardGenerateInProcess(checkoutDir, { tracker }),
): Promise<GuardGateCorpus | null> {
  const generated = await materializeAndGenerateGuard(ref, dir, generate);
  if (!generated) return null;
  return persistGeneratedGuardCorpus(guardStore, ref, dir, generated.report);
}

/** Fold the repo dismissals + the PR overlay (hosted store only — the file store
 *  has no overlay dimension) into one `dismissedClaimKey` identity set. */
async function foldDismissals(
  guardStore: GuardStore,
  repoKey: string,
  prNumber: number,
): Promise<Set<string>> {
  const fold = (out: Set<string>, decisions: GuardDecisions): Set<string> => {
    for (const c of decisions.dismissedClaims) out.add(dismissedClaimKey(c.doc, c.anchor, c.title));
    return out;
  };
  const dismissed = fold(new Set<string>(), await guardStore.readGuardDecisions(repoKey));
  if (!guardStore.materializesInPlace) {
    fold(dismissed, await guardStore.readGuardDecisions(repoKey, `_pr/${prNumber}`));
  }
  return dismissed;
}

/**
 * Record the settled verdict as a `GateRunRecord` — the row `GateStore.listRuns`
 * serves, which the dashboard's `useRepoGateRuns` → `refForTabs` mechanism reads
 * to map a PR number to its head SHA (the whole PR-scoping feed). Best-effort:
 * a persistence failure is logged, never allowed to fail the gate (the Check is
 * already authoritative). The internal 'error' conclusion is mapped to 'failure'
 * — the same mapping the Check rendering uses (the record type has no 'error').
 */
async function recordGuardGateRun(
  store: GateStore,
  payload: GuardGateRunRequest,
  decision: GuardGateDecision,
): Promise<void> {
  try {
    await store.recordRun({
      id: randomUUID(),
      repoFullName: payload.repoFullName,
      prNumber: payload.prNumber,
      headSha: payload.headSha,
      baseSha: payload.baseSha,
      conclusion: decision.conclusion === 'error' ? 'failure' : decision.conclusion,
      addedCount: decision.diff.newlyFailing.length,
      resolvedCount: decision.diff.resolved.length,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    log.warn(`[github-app] guard gate recordRun failed: ${(err as Error).message}`);
  }
}

/** Wrap a stored run as the `ok` report shape `decideGuardGate` consumes. */
function storedRunReport(latest: GuardLatest): GuardExecReport {
  return { status: 'ok', latest, latestPath: '', loadErrors: [], manifest: null };
}

/**
 * Base results for the diff: the stored baseline when the PR targets the default
 * branch, else (or on a miss) the exact `(repo, baseSha)` row. Null → no stored
 * base at all (the caller decides whether to lazy-run it).
 */
async function resolveStoredBase(
  guardStore: GuardStore,
  payload: GuardGateRunRequest,
): Promise<GuardScenarioResult[] | null> {
  if (payload.baseBranch === payload.defaultBranch) {
    const baseline = await guardStore.readGuardLatest(payload.repoFullName);
    if (baseline) return baseline.scenarios;
  }
  const exact = await guardStore.readGuardRunForCommit(payload.repoFullName, payload.baseSha);
  return exact ? exact.scenarios : null;
}

/** Inline warnings for the stale/orphaned bucket, anchored to the checked-out
 *  doc's live section lines; a missing doc or anchor falls back to line 1. */
function buildStaleAnnotations(
  checkoutDir: string,
  stale: readonly GuardScenarioResult[],
): GuardStaleAnnotation[] {
  const indexes = new Map<string, DocSectionIndex | null>();
  return stale.map((s) => {
    const doc = s.binds.doc;
    let index = indexes.get(doc);
    if (index === undefined) {
      try {
        index = buildDocSectionIndex(doc, fs.readFileSync(path.join(checkoutDir, doc), 'utf-8'));
      } catch {
        index = null;
      }
      indexes.set(doc, index);
    }
    const section = index?.byAnchor.get(s.binds.section);
    const orphaned = s.outcome === 'orphaned';
    return {
      path: doc,
      start_line: section?.startLine ?? 1,
      end_line: section?.endLine ?? 1,
      annotation_level: 'warning' as const,
      title: orphaned ? 'Guard scenario orphaned' : 'Guard scenario stale',
      message: orphaned
        ? `"${s.title}" is bound to ${doc}#${s.binds.section}, which no longer exists — the scenario did not run. Regenerate or re-anchor it.`
        : `"${s.title}" is bound to ${doc}#${s.binds.section}, whose text changed since the scenario was written — the scenario did not run. Regenerate or re-anchor it.`,
    };
  });
}

/** Copy a run's failure transcripts out of the checkout into the guard store
 *  before the checkout is removed (the run row must already be persisted). */
async function persistFailureEvidence(
  guardStore: GuardStore,
  repoKey: string,
  checkoutDir: string,
  latest: GuardLatest,
): Promise<void> {
  for (const s of latest.scenarios) {
    if ((s.outcome !== 'fail' && s.outcome !== 'error') || !s.evidencePath) continue;
    const files = collectEvidenceFiles(checkoutDir, s.evidencePath);
    if (files) {
      await guardStore.writeGuardEvidence(repoKey, latest.run.runId, s.id, files);
    }
  }
}

export function createGuardGatePipeline(seams: GuardGatePipelineSeams = {}): GuardGatePipeline {
  const clone = seams.clone ?? defaultClone;
  const checkout = seams.checkout ?? defaultCheckout;

  return {
    async run(deps, payload, opts = {}) {
      const repoKey = payload.repoFullName;
      const coords = splitRepo(repoKey);
      const octokit = deps.octokitFor(payload.installationId);
      const post = (
        conclusion: 'success' | 'failure' | 'neutral',
        output: { title: string; summary: string; annotations?: GuardStaleAnnotation[] },
      ): Promise<void> =>
        postCheck(
          octokit,
          coords,
          GUARD_GATE_CHECK_NAME,
          payload.headSha,
          conclusion,
          output,
          payload.checkRunId,
        );
      // The internal 'error' conclusion renders as a FAILURE Check (decision 1).
      const render = (d: GuardGateDecision): 'success' | 'failure' | 'neutral' =>
        d.conclusion === 'error' ? 'failure' : d.conclusion;

      // Kill switch FIRST: neutral with the disabled note — no clone, no run.
      if (guardGateDisabled()) {
        await post('neutral', guardGateDisabledOutput());
        return { conclusion: 'neutral', diff: emptyGuardGateDiff() };
      }

      const link = await deps.store.getRepo(repoKey);
      const blocking = link?.blocking ?? true;
      const dismissed = await foldDismissals(deps.guardStore, repoKey, payload.prNumber);

      // Gate-failure email — fired fire-and-forget after the Check is recorded,
      // so a redelivery (deduped by the stored head run) can't re-send. Sends
      // ONLY on a blocking `failure` (new failures vs base): the internal 'error'
      // conclusion renders as a FAILURE Check but must NOT notify (infra/build/
      // timeout is not the PR's red), and neutral/advisory outcomes stay silent.
      const prUrl = `https://github.com/${repoKey}/pull/${payload.prNumber}`;
      const checkUrl = `${prUrl}/checks`;
      const emailFailure = async (decision: GuardGateDecision): Promise<void> => {
        const notifyEmails = link?.notifyEmails ?? [];
        if (
          !deps.notifier ||
          !link ||
          decision.conclusion !== 'failure' ||
          notifyEmails.length === 0 ||
          !wantsNotification(link, 'gateFailure')
        ) {
          return;
        }
        // Resolve the deep link in the main flow (a fast local registry read,
        // and only ever on a blocking failure with recipients) so the actual
        // send below can be fired synchronously; the network send itself stays
        // fire-and-forget (the notifier never throws — see createEmailNotifier).
        const dashboardUrl = await prGuardUrl(deps.appUrl, repoKey, payload.prNumber).catch(
          () => undefined,
        );
        void deps.notifier.sendGuardGateFailure(notifyEmails, {
          repoFullName: repoKey,
          prNumber: payload.prNumber,
          prUrl,
          failing: decision.diff.newlyFailing,
          checkUrl,
          dashboardUrl,
        });
      };

      // Redelivery fast path: this head was already gated and its run persisted
      // (decision 5) — decide from the stored results, no clone, no run. The base
      // comes from the store only (no checkout exists for a lazy base run), and
      // stale annotations are skipped for the same reason. `force` (a spec-regen
      // re-gate) bypasses it to re-run the head with regenerated scenarios.
      const stored = opts.force
        ? null
        : await deps.guardStore.readGuardRunForCommit(repoKey, payload.headSha);
      if (stored) {
        const base = await resolveStoredBase(deps.guardStore, payload);
        const decision = decideGuardGate(storedRunReport(stored), base, { blocking, dismissed });
        await opts.onPhase?.('verdict');
        await post(render(decision), guardGateCheckOutput(decision));
        await recordGuardGateRun(deps.store, payload, decision);
        await emailFailure(decision);
        return decision;
      }

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-gate-'));
      try {
        await opts.onPhase?.('clone');
        const { baseSha } = await clone(
          { auth: deps.auth, signal: opts.signal },
          {
            repoFullName: repoKey,
            installationId: payload.installationId,
            baseBranch: payload.baseBranch,
            prNumber: payload.prNumber,
          },
          tmp,
        );

        // The committed corpus is the ONLY thing the gate runs (decision 2: held
        // sections never reach it, so nothing needs excluding here). Keyed by the
        // repo's baseline commit — where the onboarding generate persisted it.
        const corpusRef: RepoRef = {
          repoKey,
          commitSha: (await deps.store.getBaseline(repoKey))?.commitSha ?? '',
        };
        let corpus: GuardGateCorpus | null;
        let invalidRecipe: InvalidGuardRecipeError | null = null;
        try {
          corpus = seams.loadCorpus
            ? await seams.loadCorpus(corpusRef, tmp)
            : await defaultLoadCorpus(deps.guardStore, corpusRef);
        } catch (err) {
          if (!(err instanceof InvalidGuardRecipeError)) throw err;
          // A committed-but-unparseable recipe is a gate breakage, not an empty
          // corpus — it must reach `decideGuardGate` as `invalid-recipe` (error).
          corpus = null;
          invalidRecipe = err;
        }

        // Cold path (first-contact correctness): nothing is stored ANYWHERE for
        // this repo (the first PR arrived before onboarding generation finished),
        // and the recipe wasn't merely unparseable. Generate on THIS checkout (the
        // base tree), persist under the base commit, and run it in the same pass —
        // onboarding-that-lost-the-race. `null` → genuine absence of spec docs
        // (falls through to the neutral no-scenarios below). A generation THROW
        // propagates to the job's error Check (never neutral). Warm repos never
        // reach here — a stored corpus makes `corpus` non-null above.
        if (corpus === null && !invalidRecipe) {
          const coldRef: RepoRef = { repoKey, commitSha: baseSha };
          corpus = seams.coldGenerate
            ? await seams.coldGenerate(coldRef, tmp, opts.signal)
            : await defaultGuardColdGenerate(deps.guardStore, coldRef, tmp);
        }

        // Base results: stored baseline / exact-commit row, else a lazy base run
        // on this checkout (the tree is still at the base). The lazy run persists
        // as the repo baseline ONLY when the PR targets the default branch and
        // none is stored (decision 4); non-default bases stay ephemeral.
        //
        // `force` (a spec-regen re-gate against the PR's OWN regenerated corpus)
        // IGNORES the stored baseline: that baseline was computed from a DIFFERENT
        // corpus, so its scenario ids don't line up with the regenerated set and
        // every regenerated scenario would diff as pre-existing (never newly
        // failing). Instead it lazy-runs the base with the regenerated corpus so
        // base and head compare apples-to-apples — but EPHEMERALLY: an ad-hoc PR
        // corpus must never move the repo's real baseline.
        await opts.onPhase?.('base');
        let base = opts.force ? null : await resolveStoredBase(deps.guardStore, payload);
        if (base === null && corpus !== null && corpus.scenarios.length > 0) {
          const { recipe, scenarios } = corpus;
          const baseReport = await deps.limiter.run(() =>
            deps.execute({
              checkoutDir: tmp,
              recipe,
              scenarios,
              branch: payload.baseBranch,
              commit: baseSha,
              persist: false,
              runTimeoutMs: GUARD_GATE_RUN_TIMEOUT_MS,
              buildTimeoutMs: GUARD_GATE_BUILD_TIMEOUT_MS,
              signal: opts.signal,
            }),
          );
          if (baseReport.status === 'ok') {
            base = baseReport.latest.scenarios;
            if (!opts.force && payload.baseBranch === payload.defaultBranch) {
              await deps.guardStore.writeGuardLatest(repoKey, baseReport.latest);
            }
          }
          // A base run that produced no verdict leaves `base` null: the head is
          // still gated, and `decideGuardGate` degrades to the no-baseline neutral.
        }

        // Head run — under the limiter, against the PR head's tree.
        await opts.onPhase?.('run');
        let report: GuardExecReport;
        if (invalidRecipe) {
          report = { status: 'invalid-recipe', message: invalidRecipe.message };
        } else if (corpus === null) {
          report = { status: 'no-recipe' };
        } else if (corpus.scenarios.length === 0) {
          report = { status: 'no-scenarios', loadErrors: [] };
        } else {
          const { recipe, scenarios } = corpus;
          await checkout(tmp, payload.headSha, opts.signal);
          report = await deps.limiter.run(() =>
            deps.execute({
              checkoutDir: tmp,
              recipe,
              scenarios,
              branch: payload.headRef,
              commit: payload.headSha,
              persist: false,
              runTimeoutMs: GUARD_GATE_RUN_TIMEOUT_MS,
              buildTimeoutMs: GUARD_GATE_BUILD_TIMEOUT_MS,
              signal: opts.signal,
            }),
          );
        }

        await opts.onPhase?.('verdict');
        const decision = decideGuardGate(report, base, { blocking, dismissed });
        const output = guardGateCheckOutput(decision);
        if (decision.diff.stale.length > 0) {
          output.annotations = capGuardAnnotations(buildStaleAnnotations(tmp, decision.diff.stale));
        }
        await post(render(decision), output);
        await recordGuardGateRun(deps.store, payload, decision);
        await emailFailure(decision);

        // Persist the head run (non-baseline row keyed by headSha — decision 5:
        // redelivery dedupe) + its failure transcripts, before the checkout goes.
        if (report.status === 'ok') {
          await deps.guardStore.writeGuardRun(repoKey, report.latest);
          await persistFailureEvidence(deps.guardStore, repoKey, tmp, report.latest);
        }
        return decision;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
}

/** The production pipeline (real clone/checkout + store-backed corpus load). */
export const defaultGuardGatePipeline: GuardGatePipeline = createGuardGatePipeline();
