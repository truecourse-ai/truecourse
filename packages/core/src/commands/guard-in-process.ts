/**
 * In-process driver for Flow generation — the spec-side analogue of
 * `curateInProcess`: the estimate gate, model resolution, transport selection
 * and progress wiring live in one place.
 *
 * Steps: index (deterministic section plan) → extract (claim-extraction
 * sessions) → interfaces → flows (synthesis sessions) → match (a one-turn
 * session per flow×surface) → author (the flow-worker session pool) →
 * validate (per-flow settling). Birth
 * findings are NOT a failure — the driver surfaces them as work to review; only a
 * hard error (no docs, recipe discovery failed) is a non-success outcome.
 *
 * It also drives the recipe VIEW, and nothing more. Standalone discovery moved
 * to Flow setup: derivation now exists in exactly one place.
 */

import {
  generateGuards,
  corpusOpenApiDocs,
  recipeAuthCredentials,
  validateCredentialSatisfies,
  type SatisfiesDiagnostics,
  type GuardGenerateResult,
  type ExtractSessionSeam,
  type ReuseExtractionSeam,
  type ClaimDiffRunner,
  type RecipeRunner,
  type WorldClassifyRunner,
  type FlowsAreaSessionSeam,
  type FlowsEpicSessionSeam,
  type FlowWorkerSessionSeam,
  type MatchRunner,
  type InterfaceProvider,
  type GenerateStep,
} from '@truecourse/guard-generator';
import {
  writeGuardResult,
  buildOutputTail,
  readGuardResult,
  readManifest,
  sourceGuardRunInputs,
  loadRecipe,
  recipePath,
  type Recipe,
  type RunGuardResult,
  type ScenarioLoadError,
} from '@truecourse/guard-runner';
import {
  carryForwardBirthFindings,
  openConflicts,
  type GuardGenerateReport,
  type GuardGenerateUsage,
  type GuardScenarioResult,
  type CorpusConflict,
} from '@truecourse/shared';
import path from 'node:path';
import { assertGuardGenerateResumeCommit, GuardGenerateResumeError, type GuardGenerateResume } from '../services/guard-generate/resume.js';
import { GenerateStepNotReadyError } from '../services/guard-generate/run.js';
import type { RunError, SessionDriver, SessionLlm, SessionPersistence } from '@truecourse/agent-loop';
import { getGit } from '../lib/git.js';
import { getGuardExecutor } from '../lib/guard-executor.js';
import { resolveCommitSha } from '../lib/repo-ref.js';
import { createStoredSessionRun, type SessionRunStartedInfo, type SessionRunStore } from '../lib/sessions-store.js';
import type { GuardVisualJudge } from '@truecourse/guard-runner';
import { createGuardVisualJudge } from '../services/llm/guard-visual-judge.js';
import type { LlmTransportMode } from '../services/llm/provider-config.js';
import { createClaudeCodeSessionDriver } from '../services/llm/session-driver.js';
import { getModelPrices } from '../services/llm/model-prices.js';
import { estimateGuardTokens } from '../services/llm/spec-estimate.js';
import { mapInterfaces } from '../services/interface.service.js';
import { createGuardGenerateLeafSessions } from '../services/guard-generate/leaf-sessions.js';
import { createRecipeProposeSession } from '../services/guard-setup/recipe-propose.js';
import {
  createGuardGenerateSessionSeams,
  EXTRACT_SESSION_KIND,
  FIDELITY_SESSION_KIND,
  FLOW_WORKER_SESSION_KIND,
  FLOWS_SESSION_KIND,
  type AcquiredContext,
} from '../services/guard-generate/index.js';
export { GenerateStepNotReadyError } from '../services/guard-generate/index.js';
export { GENERATE_SESSION_STEPS, type GenerateStep } from '@truecourse/guard-generator';
export { assertGuardGenerateResumeCommit, guardGenerateResume, GuardGenerateResumeError, type GuardGenerateResume } from '../services/guard-generate/resume.js';
import { readGuardRecipeCard } from './guard-read.js';
import { readCorpus, readDecisions } from '@truecourse/spec-consolidator';
import type { LlmEstimate } from '../services/llm/token-estimator.js';
import { EstimateDeclined } from './spec-in-process.js';
import { withEstimatePhase, type EstimatePhase, type StepTracker } from '../progress.js';

export { EstimateDeclined } from './spec-in-process.js';

/**
 * The corpus has unresolved within-area overlaps — thrown by the guard-generate
 * gate before any LLM/build work. Carries the full open-conflict list (never
 * truncated) so the dashboard can return it; `message` is the assembled
 * multi-line text.
 */
export class OpenConflictsError extends Error {
  constructor(public readonly conflicts: CorpusConflict[]) {
    super(formatOpenConflictsMessage(conflicts));
    this.name = 'OpenConflictsError';
  }
}

/** The full, untruncated conflict report: a count, the rationale, every pair
 *  (area, both repo-relative doc paths, note), and the resolution pointers. */
export function formatOpenConflictsMessage(conflicts: CorpusConflict[]): string {
  const lines: string[] = [
    `${conflicts.length} open spec conflict${conflicts.length === 1 ? '' : 's'} must be resolved before guard generate.`,
    'Extracting both sides of an unresolved overlap births a red finding that is really the dispute.',
    '',
  ];
  for (const c of conflicts) {
    lines.push(`  ${c.area}`);
    lines.push(`    ${c.a}  ↔  ${c.b}`);
    if (c.note) lines.push(`    ${c.note}`);
  }
  lines.push('');
  lines.push(
    'Resolve them in the Conflicts group, then re-run Flow generation.',
  );
  return lines.join('\n');
}

/**
 * The guard-generate gate: an unresolved within-area overlap means two docs make
 * contradictory claims, and extracting BOTH births a paid "finding" that is
 * really the dispute. Read the corpus + decisions and fail before any LLM/build
 * work (and before the estimate) when any overlap is still open. No corpus at all
 * is NOT a conflict — the downstream no-docs path reports that.
 *
 * Reads the corpus + decisions out of the run's work tree — the ones the
 * generator itself reads (via the spec-consolidator file readers) — NOT the
 * active spec store. The job materializes both into the clone before generate,
 * so the gate and the generator see the same corpus + resolutions; a store keyed
 * by `owner/repo` would miss under the ephemeral clone path and silently skip
 * the gate.
 */
function assertNoOpenConflicts(repoRoot: string): void {
  const corpus = readCorpus(repoRoot);
  if (!corpus) return;
  const decisions = readDecisions(repoRoot);
  const open = openConflicts(corpus, decisions);
  if (open.length > 0) throw new OpenConflictsError(open);
}

/** Stable step taxonomy for the guard generate progress UI. */
export const GUARD_GENERATE_STEPS = [
  { key: 'index', label: 'Indexing sections' },
  { key: 'extract', label: 'Extracting claims' },
  { key: 'interfaces', label: 'Mapping interfaces' },
  { key: 'flows', label: 'Synthesizing flows' },
  { key: 'match', label: 'Matching flows' },
  { key: 'author', label: 'Working flows' },
  { key: 'validate', label: 'Settling flows' },
] as const;

/**
 * Which session kinds do each step's work — stamped onto the run record's
 * checklist so a surface reading run.json can file every session under its
 * step. The fidelity judge is a child the flow worker dispatches, so it rides
 * the author step with its parent. A step listed empty is deterministic (or a
 * direct LLM stage, like `match`) and owns no session.
 */
const GUARD_GENERATE_STEP_SESSION_KINDS: Record<string, readonly string[]> = {
  index: [],
  extract: [EXTRACT_SESSION_KIND],
  interfaces: [],
  flows: [FLOWS_SESSION_KIND],
  match: [],
  author: [FLOW_WORKER_SESSION_KIND, FIDELITY_SESSION_KIND],
  validate: [],
};

/**
 * Which LLM stage(s) each guard step covers — so a step line shows the model +
 * live tokens/$ of the work it's doing (the scan/contracts convention). Recipe
 * discovery rides `index` (the section-indexing window), extraction rides
 * `extract`, synthesis rides `flows`, realization matching rides `match`, and
 * per-(flow, surface) authoring rides `author` (stage `guard.generate`). Interface
 * mapping is deterministic tree derivation — no stage, no spend. Birth EXECUTION
 * is deterministic sandbox work, but the one evidence-retry per birth-failed flow
 * is a full re-author (stage `guard.retry`) AND every green scenario's fidelity
 * review (stage `guard.fidelity`) both happen in the settle flow — their spend
 * rides the `validate` line.
 */

export interface GuardGenerateInProcessOptions {
  tracker?: StepTracker;
  /** Restore this interrupted run's completed stages without repeating their LLM work. */
  resume?: GuardGenerateResume;
  /**
   * Run the SESSION stages (extraction, flow synthesis, the flow workers) on
   * THIS driver instead of the configured one. Ignored when every session seam
   * is injected. The run record's attribution comes from `attribution` when
   * given, else from the driver itself.
   */
  driver?: SessionDriver;
  /**
   * The mode `transport` runs in, which decides the stage models: `claude-code`
   * keeps the tier aliases the Agent SDK understands, `api` (the default)
   * substitutes the one configured API model.
   */
  transportMode?: LlmTransportMode;
  /**
   * Pre-flight LLM cost estimate gate. Called with the token estimate before any
   * LLM work; return `false` to abort (throws {@link EstimateDeclined}). Skipped
   * when nothing changed (the estimate has no stages).
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  /**
   * Progress surface for the estimate itself (it runs before the first pipeline
   * step, so the tracker can't carry it). The dashboard passes
   * `estimateStepPhase(tracker)`.
   */
  onEstimatePhase?: EstimatePhase;
  /**
   * Where the run record is keyed — the repo IDENTITY when `repoRoot` is an
   * ephemeral clone deleted after the run (a hosted job). Defaults to `repoRoot`.
   */
  sessionsKey?: string;
  /** Hosted lifecycle owns completion after result persistence. */
  sessionRun?: SessionRunStore;
  /**
   * What the run record says it ran on. A caller that built the transport
   * itself knows (the workspace's provider); unset, the session driver's own
   * attribution is stamped once it is built.
   */
  attribution?: SessionLlm;
  /** The run record just came into being — before the gates, so a generate the
   *  gates stop is on record too. The caller learns the run's id from it. */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
  /**
   * Stop the run. The generator has no abort seam of its own, so this is honored
   * at the step boundaries: the next phase transition throws
   * {@link GuardGenerateAborted} and nothing further is authored or written.
   * Work already inside a phase (a session pool, a birth sandbox) runs to its
   * end first.
   */
  signal?: AbortSignal;
  /**
   * Refuse to derive a recipe: generate loads what `guard setup` left and stops
   * without one. Defaults to false — a bare checkout with no setup bundle still
   * derives its own recipe. The job materializes setup's bundle first and passes
   * true.
   */
  requireExistingRecipe?: boolean;
  // --- test seams for the LEAF judgements (production wires the one-turn
  // sessions in `createGuardGenerateLeafSessions`) ---
  recipeRunner?: RecipeRunner;
  matchRunner?: MatchRunner;
  claimDiffRunner?: ClaimDiffRunner;
  worldClassifyRunner?: WorldClassifyRunner;
  /**
   * Session-seam overrides — tests inject stubs here. Unset, production wires
   * `createGuardGenerateSessionSeams`. The seams are REQUIRED by the engine
   * by the engine, which is why a run with no session driver is refused up
   * front unless every seam is injected.
   */
  extractSession?: ExtractSessionSeam;
  /** The claim-diff gate's extract-cache access; unset, production wires the
   *  cache-backed seam beside `extractSession`. Absent entirely (an injected
   *  `extractSession` with no `reuseExtraction`), the gate is skipped. */
  reuseExtraction?: ReuseExtractionSeam;
  flowsAreaSession?: FlowsAreaSessionSeam;
  flowsEpicSession?: FlowsEpicSessionSeam;
  flowWorkerSession?: FlowWorkerSessionSeam;
  /** Interface mapping seam — defaults to the deterministic source-facts mapper. */
  interfaces?: InterfaceProvider;
  /**
   * INTERNAL test seam: stop the pipeline after flow synthesis. Never exposed as a
   * command flag — a `--flows-only` review mode was considered and rejected;
   * curation is `dismissedFlows` and cost control is the estimate gate.
   */
  stopAfterFlows?: boolean;
  /**
   * Single-step mode (`only`): run only this session
   * step's sessions — prior steps replay from their outcome caches (a miss
   * throws {@link GenerateStepNotReadyError}), later steps never start, and
   * nothing durable is written unless the FINAL step (`worker`) runs: no
   * scenario file, no manifest, no `flows.json`, and no `guard/result.json`.
   * The estimate gate prices only the chosen step.
   */
  only?: GenerateStep;
  /** Re-author changed flows from scratch instead of editing their stored scenarios. */
  fromScratch?: boolean;
}

/**
 * The pre-flight guard estimate the dashboard renders — the SAME
 * `estimateGuardTokens(repoRoot, prices)` the driver's own gate
 * uses (deterministic token math + ceiling cost, cache-aware, "N of M sections
 * changed"). Exposed so the dashboard estimate route re-derives nothing.
 */
export async function estimateGuard(
  repoRoot: string,
  sessionModel?: string,
): Promise<LlmEstimate> {
  return estimateGuardTokens(repoRoot, await getModelPrices(), { ...(sessionModel ? { sessionModel } : {}) });
}

export interface GuardGenerateInProcessResult {
  guard: GuardGenerateResult;
  /**
   * The sessions-store scratch dir this run used, under the runtime directory —
   * what a stepwise run is inspected through. The record exists from the first
   * gate on, so it is always set.
   */
  sessionsRunDir?: string;
}

export async function guardGenerateInProcess(
  repoRoot: string,
  options: GuardGenerateInProcessOptions,
): Promise<GuardGenerateInProcessResult> {
  const { tracker } = options;
  const restored = new Set(options.resume?.completedSteps ?? []);
  // The caller says which mode this run reaches the model in: a stored provider
  // block is api mode, the operator's Claude Code is claude-code.
  const mode: LlmTransportMode = options.transportMode ?? 'api';

  // The run record — the step checklist, what it ran on, how it ended, and
  // every session's transcript, appended to its journal. Created
  // FIRST: a generate that started and was stopped by a gate — a blocked
  // corpus, a declined estimate, an unusable provider config — is still a
  // generate that started, and Activity must say so and why.
  const run =
    options.sessionRun ??
    (await createStoredSessionRun(options.sessionsKey ?? repoRoot, {
      command: 'guard-generate',
      gitRef: await resolveCommitSha(repoRoot),
    }));
  run.setLlm({ mode, ...(options.attribution ?? defaultAttribution(mode)) });
  options.onRunStarted?.({ command: 'guard-generate', runId: run.runId, dir: run.dir });
  const untap = tracker?.tap((progress) => {
    if (!progress.steps) return;
    run.setChecklist(
      progress.steps.map((step) => {
        const kinds = GUARD_GENERATE_STEP_SESSION_KINDS[step.key];
        return kinds ? { ...step, sessionKinds: [...kinds] } : step;
      }),
    );
  });

  const finishRun: SessionRunStore['finish'] = (status, opts) => {
    if (!options.sessionRun) run.finish(status, opts);
    else if (opts?.error) run.setError(opts.error);
  };

  let resumeFailure: GuardGenerateResumeError | undefined;
  try {
    // Hard-fail on unresolved spec conflicts BEFORE the estimate — never ask to
    // spend, then fail. Extracting both sides of an open overlap births noise.
    assertNoOpenConflicts(repoRoot);

    // Pre-flight cost estimate + confirm, before any LLM call. No stages ⇒ nothing
    // changed ⇒ skip the prompt and run the deterministic no-op. Decline → abort.
    if (options.onLlmEstimate) {
      const prices = await getModelPrices();
      const estimate = await withEstimatePhase(options.onEstimatePhase, () =>
        estimateGuardTokens(repoRoot, prices, {
          ...(options.attribution?.model ? { sessionModel: options.attribution.model } : {}),
          ...(options.only ? { only: options.only } : {}),
        }),
      );
      if ((estimate.stages?.length ?? 0) > 0) {
        const proceed = await options.onLlmEstimate(estimate);
        if (!proceed) throw new EstimateDeclined('guard');
      }
    }

    if (options.resume) {
      assertGuardGenerateResumeCommit(options.resume, await resolveCommitSha(repoRoot));
    }
  } catch (e) {
    // The gates run before the first step opens, so they stop on `index`, the
    // step a reader is looking at when the run ends there: a refusal takes the
    // step the way a mid-run abort does (the reason as its error, "stopped:"
    // as its fact), and a decline is a stop the user asked for, not a failure.
    // The tap stays on until the step has said so, or the record never hears it.
    if (e instanceof EstimateDeclined) {
      tracker?.fact('index', 'stopped: the cost estimate was declined');
      untap?.();
      finishRun('interrupted');
      throw e;
    }
    const reason =
      e instanceof GuardGenerateResumeError
        ? e.message
        : e instanceof OpenConflictsError
        ? (firstLine(e.message) ?? e.message)
        : `the LLM provider is unusable (${(e as Error).message})`;
    tracker?.fact('index', `stopped: ${reason}`);
    tracker?.error('index', reason);
    untap?.();
    // The record carries the reason under the gate's own kind.
    finishRun('failed', {
      error: { message: reason, kind: e instanceof GuardGenerateResumeError ? 'resume' : e instanceof OpenConflictsError ? 'open-conflicts' : 'llm-config' },
    });
    throw e;
  }

  const throwIfAborted = (): void => {
    if (resumeFailure) throw resumeFailure;
    if (options.signal?.aborted) throw new GuardGenerateAborted();
  };

  const STEPS: string[] = GUARD_GENERATE_STEPS.map((s) => s.key);
  let cur = 0;
  const advanceTo = (key: string): void => {
    throwIfAborted();
    const ni = STEPS.indexOf(key);
    if (ni <= cur) return;
    for (let i = cur; i < ni; i++) tracker?.done(STEPS[i]);
    if (!restored.has(key)) tracker?.start(key);
    cur = ni;
  };

  // The author step's line is the WORKER POOL's: `workers a/b · settled n ·
  // blocked m`, fed from the pool's per-task tick (cache hits included). The
  // grounding sweep (real-CLI probe capture, run while briefings render) rides
  // the same line so a cold run's probe minutes never look idle.
  let workersDone = 0;
  let workersTotal = 0;
  let workersSettled = 0;
  let workersBlocked = 0;
  let workersStarted = false;
  let groundCaptured = 0;
  let groundPlanned = 0;
  const workerDetail = (): string => {
    const workers = `workers ${workersDone}/${workersTotal} · settled ${workersSettled} · blocked ${workersBlocked}`;
    return groundPlanned > 0 && groundCaptured < groundPlanned
      ? `grounding probes ${groundCaptured}/${groundPlanned} · ${workers}`
      : workers;
  };
  const renderWorkers = (): void => {
    advanceTo('author');
    tracker?.detail('author', workerDetail());
  };

  // The validate step covers what happens around the pool: the recipe build
  // that precedes it ("building…"), then the per-FLOW settle counter as the
  // routing fold + persist land each flow. Every execution (birth runs,
  // confirmations, fidelity children) happens INSIDE the worker sessions now —
  // there are no separate birth/retry/fidelity/triage counters any more.
  let building = false;
  let flowsDone = 0;
  let flowsTotal = 0;
  let validateStarted = false;
  const renderValidate = (): void => {
    // The build (and the first gap-only settles) can land before the pool's
    // first tick — the author step still opens first so the checklist never
    // shows validate running ahead of a pending author line.
    advanceTo('author');
    if (!validateStarted) {
      tracker?.start('validate');
      validateStarted = true;
    }
    const parts = [`flows ${flowsDone}/${flowsTotal}`];
    if (building) parts.push('building…');
    tracker?.detail('validate', parts.join(' · '));
  };

  // The generate session seams: extraction, flow synthesis and the flow workers
  // run as agent sessions. Lazy by
  // construction: a fully-cached run creates no run record and no driver.
  // The sessions run on the command's OWN run record (created above, before
  // the gates), so the seams are handed its driver and persistence and create
  // none of their own. The driver is built LAZILY: a fully-cached run resolves
  // nothing, and an injected one (a hosted run, the workspace's provider) is
  // used as-is. Whichever it is, it states what it calls on the record —
  // unless the caller already did.
  let sessionContext: Promise<AcquiredContext> | null = null;
  const acquireSessionContext = (): Promise<AcquiredContext> =>
    (sessionContext ??= (async () => {
      if (options.driver) {
        if (!options.attribution) run.setLlm({ mode, ...options.driver.attribution });
        return { driver: options.driver, persistence: run.persistence };
      }
      const configured = createClaudeCodeSessionDriver({
        cwd: repoRoot,
        providerStateDir: path.join(run.dir, 'provider'),
      });
      if (!options.attribution) run.setLlm({ mode: configured.mode, ...configured.attribution });
      return { driver: configured.driver, persistence: run.persistence };
    })().catch((e) => ((sessionContext = null), Promise.reject(e))));
  // The LEAF judgements — the realization match, the claim-diff gate and the
  // world classification — run as one-turn sessions on the same driver and the
  // same run record as the pools. A RESUMED run refuses one whose step already
  // completed: replaying it would spend a session for work this run is
  // restoring, so the ask fails loudly and the run stops.
  const leafSessions = createGuardGenerateLeafSessions({
    acquire: acquireSessionContext,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const leafRecipe = createRecipeProposeSession({
    acquire: acquireSessionContext,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const refuseRestored = <TInput, TOut>(
    step: string,
    runner: (input: TInput) => Promise<TOut>,
  ): ((input: TInput) => Promise<TOut>) =>
    options.resume
      ? (input) => {
          if (restored.has(step)) {
            resumeFailure = new GuardGenerateResumeError(step);
            return Promise.reject(resumeFailure);
          }
          return runner(input);
        }
      : runner;
  const sessionSeams = createGuardGenerateSessionSeams({
    repoRoot,
    driver: acquireSessionContext,
    // Single-step mode: the seams enforce the cache-only replay of every step
    // before the chosen one (the engine enforces the stop after it).
    ...(options.only ? { only: options.only } : {}),
    ...(options.resume ? { replaySteps: (['extract', 'flows'] as const).filter(step => restored.has(step)) } : {}),
  });
  const extractSession = options.extractSession ?? sessionSeams.extractSession;
  // An injected extraction seam owns no cache, so the production reuse seam
  // would address entries the injected seam never wrote: the gate only rides
  // with the seam it was injected beside, or with production extraction.
  const reuseExtraction =
    options.reuseExtraction ?? (options.extractSession ? undefined : sessionSeams?.reuseExtraction);
  const flowsAreaSession = options.flowsAreaSession ?? sessionSeams.flowsAreaSession;
  const flowsEpicSession = options.flowsEpicSession ?? sessionSeams.flowsEpicSession;
  const flowWorkerSession = options.flowWorkerSession ?? sessionSeams.flowWorkerSession;

  if (options.resume) {
    for (const key of restored) tracker?.done(key, `Restoring completed work from ${options.resume.runId}`);
    tracker?.fact('index', `Resuming ${options.resume.runId}; completed authoring is replayed from saved results`);
  }
  if (!restored.has('index')) tracker?.start('index');
  try {
    // A stop asked for before the first step ends the run as interrupted, on
    // the record, like one asked for at any later boundary.
    throwIfAborted();
    const guard = await generateGuards({
      repoRoot,
      executor: getGuardExecutor(),
      // The require-a-recipe gate — where a user could have run `guard setup`, or
      // where the caller materialized setup's bundle itself (the hosted job). A
      // generate over a bare checkout keeps deriving its own recipe.
      requireExistingRecipe: options.requireExistingRecipe ?? false,
      recipeRunner: options.recipeRunner ?? refuseRestored('index', leafRecipe.runner),
      matchRunner: options.matchRunner ?? refuseRestored('match', leafSessions.matchRunner),
      claimDiffRunner:
        options.claimDiffRunner ?? refuseRestored('extract', leafSessions.claimDiffRunner),
      worldClassifyRunner: options.worldClassifyRunner ?? leafSessions.worldClassifyRunner,
      leafSummaries: () => [...leafSessions.summaries(), leafRecipe.summary()],
      extractSession,
      ...(reuseExtraction ? { reuseExtraction } : {}),
      flowsAreaSession,
      flowsEpicSession,
      flowWorkerSession,
      interfaces:
        options.interfaces ??
        (async () => {
          // ONE working-tree analysis feeds every half: the interface catalog, the
          // repo's detected third-party dependencies, and the code-truth grounding
          // authoring needs.
          const mapped = await mapInterfaces(repoRoot);
          return {
            interfaces: mapped.catalog.interfaces,
            // The resource registry rides the same seam — the mapper forms the
            // cli and api places itself now, and a hand-authored
            // web registry arrives the same way.
            ...(mapped.catalog.resources ? { resources: mapped.catalog.resources } : {}),
            externalServices: mapped.externalServices,
            database: mapped.database,
            datastoreUrls: mapped.datastoreUrls,
            outboundRequests: mapped.outboundRequests,
          };
        }),
      ...(options.stopAfterFlows ? { stopAfterFlows: true } : {}),
      ...(options.only ? { only: options.only } : {}),
      ...(options.fromScratch ? { fromScratch: true } : {}),
      onPlan: (total, work) => {
        throwIfAborted();
        // Indexing is an instant deterministic pass — mark it done with its result
        // detail immediately (recipe-discovery usage rides its tag), never a live phase.
        tracker?.done('index', `${work} of ${total} section${total === 1 ? '' : 's'} changed`);
        cur = STEPS.indexOf('extract');
        // No detail yet — the seam's initial onDoc(0, total) supplies the
        // "docs 0/N" counter the moment the pool is planned.
        if (!restored.has('extract')) tracker?.start('extract');
      },
      onExtractProgress: (done, total) => {
        advanceTo('extract');
        if (done >= total) {
          tracker?.done('extract', `${total} doc${total === 1 ? '' : 's'}`);
        } else {
          tracker?.detail('extract', `docs ${done}/${total}`);
        }
      },
      onInterfaces: (interfaces, surfaces) => {
        // Interface mapping is deterministic and free — it completes as one step with
        // its result, never a live counter with a model tag.
        advanceTo('interfaces');
        tracker?.done(
          'interfaces',
          `${interfaces} interface${interfaces === 1 ? '' : 's'} · ${surfaces} surface${surfaces === 1 ? '' : 's'}`,
        );
      },
      onFlowProgress: (done, total) => {
        advanceTo('flows');
        if (done >= total) {
          tracker?.done('flows', `${total} area${total === 1 ? '' : 's'}`);
        } else {
          tracker?.detail('flows', `areas ${done}/${total}`);
        }
      },
      onMatchProgress: ({ done, total, matched, unmatched, blocked }) => {
        advanceTo('match');
        const tally = `${matched} matched · ${unmatched} no match · ${blocked} blocked`;
        if (done >= total) {
          tracker?.done('match', `${total} flow×surface · ${tally}`);
        } else {
          tracker?.detail('match', `${done}/${total} flow×surface · ${tally}`);
        }
      },
      onWorkerProgress: ({ done, total, settled, blocked }) => {
        workersDone = done;
        workersTotal = total;
        workersSettled = settled;
        workersBlocked = blocked;
        workersStarted = true;
        // The worker line ticks until the last session settles, then completes
        // with its outcome tally.
        if (done >= total && total > 0) {
          tracker?.done('author', workerDetail());
        } else {
          renderWorkers();
        }
      },
      onGroundProgress: (captured, planned) => {
        groundCaptured = captured;
        groundPlanned = planned;
        // Probes are captured while worker briefings render, before the pool's
        // first tick — the grounding prefix keeps the line honest meanwhile.
        if (workersStarted && workersDone >= workersTotal && workersTotal > 0) return;
        renderWorkers();
      },
      onBirthPhase: (phase) => {
        // Only 'build' fires now — the recipe build that precedes the pool.
        building = phase === 'build';
        renderValidate();
      },
      // One line per THING the run did, filed under the step that did it. The
      // engine's phase names ARE this checklist's keys, so they line up.
      onFact: (step, line) => tracker?.fact(step, line),
      onStepIncomplete: step => tracker?.partial(step),
      onFlowSettled: async (settled, total) => {
        throwIfAborted();
        building = false;
        flowsDone = settled;
        flowsTotal = total;
        // Gap-only flows settle without any worker running — only re-render a
        // LIVE validate line; never start the step early.
        if (validateStarted || settled > 0) renderValidate();
        // Drain persistence before advancing: a synchronous settlement burst
        // must not retain hundreds of complete progress snapshots.
        await run.flush?.();
      },
    });

    throwIfAborted();

    // An early abort (no corpus, an unusable recipe, a stage that lost every LLM
    // call) ran NO phase past the one it died in: the step it died in takes the
    // error, and every later step stays
    // PENDING. Marking them done would print "Authoring — 0 tests written" and
    // "Birth-validating — 0/0 flows settled" for work that never happened, and the
    // dashboard popup (same steps payload) would tick them green.
    if (guard.status === 'no-docs' || guard.status === 'recipe-failed' || guard.status === 'llm-failed') {
      tracker?.fact(STEPS[cur], `stopped: ${firstLine(guard.reason) ?? `the run ended ${guard.status}`}`);
      tracker?.error(STEPS[cur], firstLine(guard.reason) ?? 'aborted');
      // Single-step mode, before the final step: the same write gate as a clean
      // stop. This run could never have produced a whole generate's report, so
      // persisting one would overwrite the LAST FULL generate's `result.json`
      // (what the dashboard reads) with a partial abort. The
      // caller still gets the failure — loudly, and non-zero.
      if (!options.only || options.only === 'worker') persistGuardReport(repoRoot, guard);
      finishRun('failed', {
        error: { message: firstLine(guard.reason) ?? `generate ended ${guard.status}`, kind: guard.status },
      });
      return { guard, sessionsRunDir: run.dir };
    }

    // A single-step run stopped BEFORE the final step: close only the step that
    // actually opened (a caller may hand the tracker a reduced checklist, so
    // the later keys don't exist — and StepTracker no-ops on unknown keys anyway),
    // and persist NOTHING. `guard/result.json` describes a completed generate;
    // a partial run's counts would read as a whole one's.
    if (guard.stoppedAfter) {
      tracker?.done(STEPS[cur], `stopped after ${guard.stoppedAfter}`);
      if (!options.sessionRun) finishRun('completed');
      return { guard, sessionsRunDir: run.dir };
    }

    // Mark every remaining step done with a closing detail.
    for (let i = cur; i < STEPS.length; i++) tracker?.done(STEPS[i]);
    if (guard.noChanges) {
      tracker?.done('validate', 'nothing changed');
    } else {
      tracker?.done('author', `${guard.written.length} test${guard.written.length === 1 ? '' : 's'} written`);
      // Every authored test is stored, so the validate line reports the split:
      // how many landed green vs. red at the worker's confirmation run.
      const failing = guard.written.filter((w) => w.status === 'failing').length;
      const failingTag = failing ? ` · ${failing} failing` : '';
      tracker?.done(
        'validate',
        `${guard.flows.settled}/${guard.flows.total} flow${guard.flows.total === 1 ? '' : 's'} settled · ${guard.written.length} written${failingTag}`,
      );
    }

    // Persist the last-generate report next to the scenarios it describes. Written
    // on every completed generate (including the noChanges no-op); NOT on a thrown
    // error, which never reaches here — the report describes a completed generate.
    persistGuardReport(repoRoot, guard);
    if (!options.sessionRun) finishRun('completed');

    return { guard, sessionsRunDir: run.dir };
  } catch (caught) {
    const e = options.resume && caught instanceof GenerateStepNotReadyError
      ? new GuardGenerateResumeError(caught.step)
      : caught;
    tracker?.error(STEPS[cur], (e as Error).message);
    // A stop the caller asked for is not a failure; anything else lands its
    // reason on the record, the only place a watcher can read it.
    if (options.signal?.aborted) finishRun('interrupted');
    else finishRun('failed', { error: { message: (e as Error).message, kind: 'generate' } });
    throw e;
  } finally {
    untap?.();
  }
}

/** Thrown at the next step boundary once `options.signal` aborted. */
export class GuardGenerateAborted extends Error {
  constructor() {
    super('guard generate was cancelled');
    this.name = 'GuardGenerateAborted';
  }
}

/**
 * What the run record says before its session driver exists: how it will reach
 * the model, and no model yet. The driver's own attribution replaces it the
 * moment a session is acquired; a fully-cached run that acquires none keeps
 * this. Never credentials.
 */
function defaultAttribution(mode: LlmTransportMode): SessionLlm {
  return { provider: mode === 'api' ? 'api' : 'claude-code', model: 'default' };
}

/** The first line of a (possibly multi-line, guided) abort reason — a step detail
 *  is one terminal row, and the full reason is printed by the caller. */
function firstLine(reason: string | undefined): string | undefined {
  return reason?.split('\n')[0]?.trim() || undefined;
}

/**
 * Persist the generate report, carrying forward the PRIOR report's birth findings
 * for stored failing tests this generate did not re-execute (see
 * `carryForwardBirthFindings`) — without it, a cached/no-op regenerate wipes the
 * only record of what those red tests actually saw (expected/actual/evidence)
 * while the manifest still marks them failing. The prior report is read BEFORE
 * the write, off the same path.
 */
function persistGuardReport(repoRoot: string, guard: GuardGenerateResult): void {
  // What this run SPENT is not the report's to hold: every turn of every
  // session is an `llm_usage` row, and the run record carries the total. The
  // field stays on the schema so a report stored before that parses.
  const report = buildGuardReport(guard, new Date().toISOString());
  writeGuardResult(
    repoRoot,
    carryForwardBirthFindings(report, readGuardResult(repoRoot), readManifest(repoRoot)),
  );
}

/**
 * Compose the persisted report from the generator result plus `generatedAt`.
 * Pure — the result is a superset of the generate result, so the dashboard can
 * build the same shape from an in-memory result. `usage` is only ever read: a
 * report stored before every call became a turn of a session carries one.
 */
export function buildGuardReport(
  result: GuardGenerateResult,
  generatedAt: string,
  usage?: GuardGenerateUsage,
): GuardGenerateReport {
  return { ...result, generatedAt, ...(usage ? { usage } : {}) };
}

/**
 * The blocked report an unresolved-conflict generate persists: `status:
 * 'open-conflicts'` with the error's formatted multi-line message as `reason`,
 * and every list field empty (nothing generated). The conflict list is NOT
 * snapshotted — surfaces render it live from the corpus. Used by the hosted
 * generate job to record a needs-attention outcome without saving a scenario
 * set.
 */
export function buildOpenConflictsReport(
  error: OpenConflictsError,
  generatedAt: string,
): GuardGenerateReport {
  return {
    generatedAt,
    status: 'open-conflicts',
    reason: error.message,
    sectionsTotal: 0,
    sectionsChanged: 0,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  };
}

// ---------------------------------------------------------------------------
// guard run — the deterministic, LLM-free verification pass.
// ---------------------------------------------------------------------------

/** Stable step taxonomy for the guard run progress UI. */
export const GUARD_RUN_STEPS = [
  { key: 'build', label: 'Building via recipe' },
  { key: 'run', label: 'Running scenarios' },
] as const;

export interface GuardRunInProcessOptions {
  tracker?: StepTracker;
  /** Restrict the run to a single scenario id. */
  scenario?: string;
  /** Fires with each scenario's result as it settles. */
  onScenarioResult?: (result: GuardScenarioResult) => void;
  /**
   * The visual judge for a failing web step, passed whole. A test that must
   * never reach a model passes one that returns `null`; production passes
   * {@link GuardRunInProcessOptions.judgeDriver} instead and lets this command
   * build it.
   */
  visualJudge?: GuardVisualJudge;
  /**
   * The driver a visual VERDICT runs on — the asking workspace's. Its run
   * record and the verdict's transcript come into being on the first verdict
   * and never otherwise: a green run makes none, and the judge is parked (off
   * by default) until its cost/value is settled.
   */
  judgeDriver?: SessionDriver;
  /** Where that record is keyed, when `repoRoot` is an ephemeral clone. */
  sessionsKey?: string;
}

/**
 * In-process driver for a Flow run — the guard analogue of the
 * curate/generate drivers. Resolves the repo ref, runs the stored scenarios
 * through the guard-runner, and drives a tracker through GUARD_RUN_STEPS (build →
 * run, with a live per-scenario counter) so every surface watching the run sees
 * the same stream. Returns the runner's discriminated result untouched
 * — the caller decides how to present each status.
 *
 * Deterministic, with ONE opt-in annotation: when the caller hands in a visual
 * judge (the hosted run job does, on the workspace's transport, only while
 * `guardVisualJudgeEnabled` says so — the judge is parked, off by default), a
 * failing WEB step's screenshot is shown to a vision model, whose verdict is
 * recorded beside the failure. It cannot move an outcome and it never fires on
 * a green run, so a passing run is exactly as LLM-free as it always was. THIS is
 * the boundary the judge is wired at — the guard-runner takes it as an optional
 * callback, so every caller that passes none (birth validation, the test suite,
 * a hosted executor) runs with no judge and no model at all.
 */
export async function guardRunInProcess(
  repoRoot: string,
  options: GuardRunInProcessOptions = {},
): Promise<RunGuardResult> {
  const { tracker } = options;
  const { branch, commit } = await resolveGuardRepoRef(repoRoot);

  // The "is there anything to run" decision stays local — a hosted executor should
  // never be invoked just to discover a missing recipe or an empty corpus. Source
  // the recipe + scenarios through the runner's own helper, map the no-recipe /
  // invalid-recipe / no-scenarios results WITHOUT crossing the seam, then hand the
  // resolved recipe + selected scenarios to the executor for actual execution.
  const sourced = sourceGuardRunInputs(repoRoot, options.scenario);
  if ('early' in sourced) return sourced.early;
  const { loaded, selected, corpusIds, loadErrors } = sourced;

  // Failure-only, fail-soft, and unable to change a verdict — see the doc above.
  // The verdict's run record is LAZY: a run whose web steps all pass never
  // creates one, which is the overwhelming majority of runs.
  const judgeRecord: { opened: Promise<SessionRunStore> | null } = { opened: null };
  const acquireJudgeSession = async (): Promise<{
    driver: SessionDriver;
    persistence: SessionPersistence;
  }> => {
    const driver = options.judgeDriver;
    if (!driver) throw new Error('this run has no driver to judge a screenshot on');
    judgeRecord.opened ??= createStoredSessionRun(options.sessionsKey ?? repoRoot, {
      command: 'guard-run',
      gitRef: await resolveCommitSha(repoRoot),
    }).then((store) => {
      store.setLlm({ mode: 'api', ...driver.attribution });
      return store;
    });
    return { driver, persistence: (await judgeRecord.opened).persistence };
  };
  const visualJudge =
    options.visualJudge ??
    (options.judgeDriver ? createGuardVisualJudge(repoRoot, { acquire: acquireJudgeSession }) : undefined);

  const result = mergeLoadErrors(
    await getGuardExecutor()({
      checkoutDir: repoRoot,
      recipe: loaded.recipe,
      scenarios: selected,
      // The `scenario` filter was applied HERE, so the run has to be told what it
      // filtered out: a scoped run merges into the recorded board, and only the ids
      // that left the corpus may drop off it.
      corpusIds,
      branch,
      commit,
      persist: true,
      ...(visualJudge ? { visualJudge } : {}),
      onPhase: (phase, total) => {
        if (phase === 'build') tracker?.start('build');
        else {
          tracker?.done('build');
          tracker?.start('run', `0/${total} scenarios`);
        }
      },
      onScenarioSettled: (done, total, scenarioResult) => {
        tracker?.detail('run', `${done}/${total} scenarios`);
        options.onScenarioResult?.(scenarioResult);
      },
    }),
    loadErrors,
  );
  if (result.status === 'ok') {
    const n = result.latest.summary.total;
    tracker?.done('run', `${n} scenario${n === 1 ? '' : 's'}`);
  } else if (result.status === 'build-failed') {
    const tail = buildOutputTail(result.build.output, 3).split('\n').join(' | ').slice(0, 300);
    tracker?.error('build', `Build failed (\`${result.build.command}\`)${result.build.timedOut ? ' — timed out' : ''}${tail ? `: ${tail}` : ''}`);
  } else if (result.status === 'entry-preflight-failed') {
    // Build succeeded but the entry can't start — the run never began; mark the build
    // phase (where the entry is prepared) errored so the popup shows the sticky error.
    tracker?.error('build', `Entry failed to start: \`${result.preflight.entry}\` (rebuild via \`${result.buildCommand}\`)`);
  } else if (result.status === 'missing-external-env') {
    // A declared external API account is only partly configured — resolved in the
    // build phase, before any server boots; same treatment as a missing credential env.
    tracker?.error('build', result.message);
  } else if (result.status === 'missing-credential-env') {
    // A declared api credential's env var is unset at run start — resolved in the
    // build phase, before any server boots; mark it errored so the spinner doesn't hang.
    tracker?.error('build', result.message);
  } else if (result.status === 'seed-failed') {
    // The api seed command failed — runs in the build phase (after services.up,
    // before any server boots); mark it errored so the spinner doesn't hang.
    tracker?.error('build', result.message);
  } else if (result.status === 'credential-request-failed') {
    // A `fromRequest` credential's login failed — runs against the preflight boot,
    // still inside the build phase; same treatment as a failed seed.
    tracker?.error('build', result.message);
  }
  // The verdict record, when any verdict was asked for: the run it belongs to
  // is over either way, so it is closed on the run's own outcome.
  if (judgeRecord.opened) {
    const store = await judgeRecord.opened.catch(() => null);
    store?.finish(result.status === 'ok' ? 'completed' : 'failed');
  }
  return result;
}

/**
 * Re-attach the scenario load errors this driver computed to the executor's result.
 * The executor ran the pre-filtered corpus we passed in, so `runGuard` never loaded
 * scenarios and its own `loadErrors` is empty — the malformed-file errors are a
 * local concern we surface, keeping the result bit-identical to a disk-loading run.
 */
function mergeLoadErrors(result: RunGuardResult, loadErrors: ScenarioLoadError[]): RunGuardResult {
  // Shape-based so a future result variant that carries loadErrors is covered
  // automatically instead of silently dropping them.
  return 'loadErrors' in result ? { ...result, loadErrors } : result;
}

/** Current branch + commit for a run's envelope; both null outside a git repo. */
async function resolveGuardRepoRef(repoRoot: string): Promise<{ branch: string | null; commit: string | null }> {
  try {
    const git = await getGit(repoRoot);
    const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    const commit = (await git.revparse(['HEAD'])).trim();
    return { branch: branch || null, commit: commit || null };
  } catch {
    return { branch: null, commit: null };
  }
}

// ---------------------------------------------------------------------------
// guard recipe — the recipe view and its standalone (re-)discovery.
// ---------------------------------------------------------------------------

/**
 * What the recipe VIEW renders: the recipe as the runner loads it, plus
 * the staleness the dashboard card already computes. `recipe` and `invalidReason`
 * are mutually exclusive and both null when no `recipe.json` exists;
 * `fingerprint`/`stale` come from {@link readGuardRecipeCard}, so no two surfaces
 * can disagree about whether the recipe drifted.
 */
export interface GuardRecipeView {
  /** Absolute path to `recipe.json`, whether or not the file exists. */
  path: string;
  /** The loaded recipe; null when absent OR unparseable (see `invalidReason`). */
  recipe: Recipe | null;
  /** The loader's own diagnostic when the file exists but does not parse. */
  invalidReason: string | null;
  /** `sha256:…` over the discovery inputs; null when there is no valid recipe. */
  fingerprint: string | null;
  /** Always null: there is no working tree to fingerprint, so staleness is
   *  unknowable — the recipe-card read never claims otherwise. */
  stale: boolean | null;
  /**
   * The credential `satisfies` verdict against the corpus's OpenAPI schemes — the
   * SAME check `guard generate` fails on, surfaced while showing the
   * recipe so the defect is visible before a generate is paid for. Both lists are
   * empty when there is no recipe (nothing to validate).
   */
  credentialSchemes: SatisfiesDiagnostics;
}

/** Read the current recipe + its staleness. Never throws: an invalid recipe is a
 *  reported state, not an error — the command's whole job is to show it. */
export async function readGuardRecipeView(repoRoot: string): Promise<GuardRecipeView> {
  const file = recipePath(repoRoot);
  let recipe: Recipe | null = null;
  let invalidReason: string | null = null;
  try {
    recipe = loadRecipe(repoRoot, file)?.recipe ?? null;
  } catch (err) {
    invalidReason = err instanceof Error ? err.message : String(err);
  }
  // The card is the ONE staleness computation (it also serves the dashboard); it
  // reads null for an absent or invalid recipe, which is exactly this view's null.
  const card = recipe ? await readGuardRecipeCard(repoRoot) : null;
  // Cheap by construction: `corpusOpenApiDocs` reads only corpus docs with an
  // OpenAPI extension, so a markdown-only (or credential-less) repo touches no file.
  const credentials = recipe ? recipeAuthCredentials(recipe) : [];
  const credentialSchemes =
    credentials.some((c) => c.satisfies)
      ? validateCredentialSatisfies(credentials, corpusOpenApiDocs(repoRoot))
      : { errors: [], warnings: [] };
  return {
    path: file,
    recipe,
    invalidReason,
    fingerprint: card?.fingerprint ?? null,
    stale: card?.stale ?? null,
    credentialSchemes,
  };
}
