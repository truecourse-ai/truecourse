/**
 * In-process driver for `truecourse guard generate` — the spec-side analogue of
 * `curateInProcess`. Shared by the CLI and the dashboard so the estimate gate,
 * model resolution, transport selection, and progress wiring live in one place.
 *
 * Steps: index (deterministic section plan) → extract (claim-extraction
 * sessions) → interfaces → flows (synthesis sessions) → match (one-shot) →
 * author (the flow-worker session pool) → validate (per-flow settling). Birth
 * findings are NOT a failure — the driver surfaces them as work to review; only a
 * hard error (no docs, recipe discovery failed) is a non-success outcome.
 *
 * It also drives `truecourse guard recipe` — the recipe VIEW, and nothing more.
 * Standalone discovery moved to `truecourse guard setup`: derivation now
 * exists in exactly one place, so nothing can prepare a repo behind the gate's back.
 */

import {
  generateGuards,
  corpusOpenApiDocs,
  recipeAuthCredentials,
  validateCredentialSatisfies,
  type SatisfiesDiagnostics,
  type GuardGenerateResult,
  type GuardGenerateModels,
  type ExtractSessionSeam,
  type RecipeRunner,
  type FlowsAreaSessionSeam,
  type FlowsEpicSessionSeam,
  type FlowWorkerSessionSeam,
  type MatchRunner,
  type InterfaceProvider,
  type GenerateStep,
} from '@truecourse/guard-generator';
import {
  writeGuardResult,
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
import { getGit } from '../lib/git.js';
import { getGuardExecutor } from '../lib/guard-executor.js';
import { guardsMaterializeInPlace } from '../lib/guard-store.js';
import {
  agentTransport,
  cliTransport,
  getDefaultTransport,
  getStageUsage,
  resetStageUsage,
  setLlmCallSink,
  type LlmTransport,
} from '@truecourse/shared/llm';
import { createConfiguredApiTransport } from '../services/llm/install-transport.js';
import { createGuardVisualJudge, guardVisualJudgeEnabled } from '../services/llm/guard-visual-judge.js';
import type { GuardVisualJudge } from '@truecourse/guard-runner';
import { effectiveLlmMode, type LlmTransportMode } from '../config/global-config.js';
import { resolveFallbackModel, resolveModel, type StageId } from '../config/llm-models.js';
import { createLlmCallLogger } from '../lib/llm-call-log.js';
import { getModelPrices } from '../services/llm/model-prices.js';
import { estimateGuardTokens } from '../services/llm/spec-estimate.js';
import { mapInterfaces } from '../services/interface.service.js';
import { createGuardGenerateSessionSeams } from '../services/guard-generate/index.js';
import type { SessionRunStartedInfo } from '../lib/sessions-store.js';
export { GenerateStepNotReadyError } from '../services/guard-generate/index.js';
export { GENERATE_SESSION_STEPS, type GenerateStep } from '@truecourse/guard-generator';
import { readGuardRecipeCard } from './guard-read.js';
import { readCorpus, readDecisions } from '@truecourse/spec-consolidator';
import type { LlmEstimate } from './analyze-core.js';
import { EstimateDeclined, stageUsageTag } from './spec-in-process.js';
import { withEstimatePhase, type EstimatePhase, type StepTracker } from '../progress.js';

export { EstimateDeclined } from './spec-in-process.js';

/**
 * The corpus has unresolved within-area overlaps — thrown by the guard-generate
 * gate before any LLM/build work. Carries the full open-conflict list (never
 * truncated) so the CLI can print it and the dashboard can return it; `message`
 * is the assembled multi-line text both surfaces reuse.
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
    'Resolve them with `truecourse spec conflicts list` (or the dashboard Conflicts group), then re-run `truecourse guard generate`.',
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
 * Reads the ON-DISK `.truecourse/specs/{corpus,decisions}.json` the generator
 * itself reads (via the spec-consolidator file readers) — NOT the active spec
 * store. OSS is byte-identical (the store was these files). EE materializes both
 * artifacts into the checkout before generate, so the gate and the generator see
 * the same corpus + resolutions; a store keyed by `owner/repo` would miss under
 * the ephemeral checkout path and silently skip the gate.
 */
function assertNoOpenConflicts(repoRoot: string): void {
  const corpus = readCorpus(repoRoot);
  if (!corpus) return;
  const decisions = readDecisions(repoRoot);
  const open = openConflicts(corpus, decisions);
  if (open.length > 0) throw new OpenConflictsError(open);
}

/** Stable step taxonomy for the guard generate progress UI (CLI + dashboard). */
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
 * Which TRANSPORT LLM stage(s) each guard step covers — so a step line shows
 * the model + live tokens/$ of the work it's doing. Only the two remaining
 * one-shot stages ride the transport: recipe discovery on `index` and
 * realization matching on `match`. Extraction, flow synthesis and the flow
 * workers run as AGENT SESSIONS (plan 04) — their spend rides the sessions
 * store (`sessions/guard-generate/<runId>/`), not the stage-usage sink, so
 * those steps carry no usage tag. Interface mapping is deterministic tree
 * derivation — no stage, no spend.
 */
const GUARD_STEP_STAGES: Record<string, StageId[]> = {
  index: ['guard.recipe'],
  extract: [],
  interfaces: [],
  flows: [],
  match: ['guard.match'],
  author: [],
  validate: [],
};

export interface GuardGenerateInProcessOptions {
  tracker?: StepTracker;
  /**
   * LLM transport: `cli` (spawn `claude -p`), `agent` (mailbox under `io`), or
   * `api` (the provider configured in `~/.truecourse/config.json`). Unset
   * follows the saved selection.
   */
  llm?: 'cli' | 'agent' | 'api';
  io?: string;
  /**
   * Pre-flight LLM cost estimate gate. Called with the token estimate before any
   * LLM work; return `false` to abort (throws {@link EstimateDeclined}). Skipped
   * when nothing changed (the estimate has no stages).
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  /**
   * Progress surface for the estimate itself (it runs before the first pipeline
   * step, so the tracker can't carry it). The CLI resolves a spinner line above
   * the estimate panel; the dashboard passes `estimateStepPhase(tracker)`.
   */
  onEstimatePhase?: EstimatePhase;
  // --- test seams for the two remaining one-shot stages (production injects
  // none; an injected runner bypasses the transport) ---
  recipeRunner?: RecipeRunner;
  matchRunner?: MatchRunner;
  /**
   * Session-seam overrides (plan 04) — tests inject stubs here. Unset,
   * production wires `createGuardGenerateSessionSeams`. The seams are REQUIRED
   * by the engine since the one-shot retirement (step 20), which is why
   * `--llm agent` (the mailbox transport, which has no session driver) is
   * refused up front unless every seam is injected.
   */
  extractSession?: ExtractSessionSeam;
  flowsAreaSession?: FlowsAreaSessionSeam;
  flowsEpicSession?: FlowsEpicSessionSeam;
  flowWorkerSession?: FlowWorkerSessionSeam;
  /** Interface mapping seam — defaults to the deterministic analyzer-backed mapper. */
  interfaces?: InterfaceProvider;
  /**
   * INTERNAL test seam: stop the pipeline after flow synthesis. Never exposed as a
   * command flag — a `--flows-only` review mode was considered and rejected;
   * curation is `dismissedFlows` and cost control is the estimate gate.
   */
  stopAfterFlows?: boolean;
  /**
   * The (lazily created) sessions-store run record just came into being —
   * fired on first session; never on a fully-cached run. The CLI prints the
   * dashboard "watch live" deep link from it.
   */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
  /**
   * Single-step mode (the CLI's `--only-<step>` flags): run only this session
   * step's sessions — prior steps replay from their outcome caches (a miss
   * throws {@link GenerateStepNotReadyError}), later steps never start, and
   * nothing durable is written unless the FINAL step (`worker`) runs: no
   * scenario file, no manifest, no `flows.json`, and no `guard/result.json`.
   * The estimate gate prices only the chosen step.
   */
  only?: GenerateStep;
}

/**
 * The pre-flight guard estimate the dashboard renders — the SAME
 * `estimateGuardTokens(repoRoot, prices)` the CLI prompt and the driver's own gate
 * use (deterministic token math + ceiling cost, cache-aware, "N of M sections
 * changed"). Exposed so the dashboard estimate route re-derives nothing.
 */
export async function estimateGuard(
  repoRoot: string,
  mode?: LlmTransportMode,
): Promise<LlmEstimate> {
  return estimateGuardTokens(repoRoot, await getModelPrices(), { mode });
}

/**
 * The models of the two remaining ONE-SHOT stages. Every session stage
 * (extraction, flow synthesis, the flow workers, the fidelity children) runs on
 * the ONE configured session model (§3.4) inside
 * `createGuardGenerateSessionSeams` — there is no per-stage tier for them.
 */
function resolveGuardModels(repoRoot: string, mode: LlmTransportMode): GuardGenerateModels {
  return {
    match: resolveModel('guard.match', undefined, repoRoot, mode),
    recipe: resolveModel('guard.recipe', undefined, repoRoot, mode),
    fallback: resolveFallbackModel(repoRoot, mode) ?? undefined,
  };
}

/**
 * Build the LLM transport for a run — an explicit per-run override of the saved
 * selection. `agent` → the filesystem mailbox under `options.io`; `api` → the
 * direct-API transport from the user's global config (throws when it isn't
 * configured); `cli` → `claude -p`, forcing Claude Code even when an API
 * transport is the installed default; unset → the installed default, else
 * `undefined` so each runner falls back to its built-in cli transport.
 *
 * {@link effectiveLlmMode} moves the STAGE MODELS the same way, so a `cli` flag
 * never hands an api-configured model to `claude -p`.
 */
function resolveTransport(options: {
  llm?: 'cli' | 'agent' | 'api';
  io?: string;
}): LlmTransport | undefined {
  if (options.llm === 'agent') {
    if (!options.io) {
      throw new Error('--llm agent requires --io <dir> (the request/response mailbox directory)');
    }
    return agentTransport(options.io);
  }
  if (options.llm === 'api') return createConfiguredApiTransport();
  if (options.llm === 'cli') return cliTransport();
  return getDefaultTransport();
}

export interface GuardGenerateInProcessResult {
  guard: GuardGenerateResult;
  /**
   * The sessions-store run dir (`.truecourse/sessions/guard-generate/<runId>/`)
   * this run's transcripts landed in — what a stepwise run is inspected
   * through. Absent when no session ran (a fully-cached step) or when the
   * caller injected its own seams.
   */
  sessionsRunDir?: string;
}

export async function guardGenerateInProcess(
  repoRoot: string,
  options: GuardGenerateInProcessOptions = {},
): Promise<GuardGenerateInProcessResult> {
  const { tracker } = options;
  // The transport this run actually uses decides the models — never the saved
  // selection a `--llm-transport` flag just overrode.
  const mode = effectiveLlmMode(options.llm);

  // Hard-fail on unresolved spec conflicts BEFORE the estimate — never ask to
  // spend, then fail. Extracting both sides of an open overlap births noise.
  assertNoOpenConflicts(repoRoot);

  // Pre-flight cost estimate + confirm, before any LLM call. No stages ⇒ nothing
  // changed ⇒ skip the prompt and run the deterministic no-op. Decline → abort.
  if (options.onLlmEstimate) {
    const prices = await getModelPrices();
    const estimate = await withEstimatePhase(options.onEstimatePhase, () =>
      estimateGuardTokens(repoRoot, prices, { mode, ...(options.only ? { only: options.only } : {}) }),
    );
    if ((estimate.stages?.length ?? 0) > 0) {
      const proceed = await options.onLlmEstimate(estimate);
      if (!proceed) throw new EstimateDeclined('guard');
    }
  }

  resetStageUsage();
  const llmLog = createLlmCallLogger(repoRoot, 'guard-generate');
  if (llmLog) setLlmCallSink(llmLog.sink);
  const startedAt = Date.now();

  const STEPS: string[] = GUARD_GENERATE_STEPS.map((s) => s.key);
  let cur = 0;
  const advanceTo = (key: string): void => {
    const ni = STEPS.indexOf(key);
    if (ni <= cur) return;
    for (let i = cur; i < ni; i++) tracker?.done(STEPS[i]);
    tracker?.start(key);
    cur = ni;
  };

  // A step's detail line = base text + its live usage tag (model/tokens/$).
  const withUsage = (key: string, base: string): string => `${base}${stageUsageTag(GUARD_STEP_STAGES[key] ?? [], repoRoot, mode)}`;

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

  // The generate session seams (plan 04): extraction, flow synthesis and the
  // flow workers run as agent sessions — THE paths since the one-shot
  // retirement (step 20). Lazy by construction: a fully-cached run creates no
  // run record and no driver. The `agent` mailbox transport has no session
  // driver, so it cannot drive a generate any more — refused up front (before
  // the estimate already ran above) unless a test injected every seam.
  const seamsInjected =
    options.extractSession && options.flowsAreaSession && options.flowsEpicSession && options.flowWorkerSession;
  if (options.llm === 'agent' && !seamsInjected) {
    throw new Error(
      'guard generate runs its LLM stages as agent sessions, and the `agent` mailbox transport has no session driver — use `--llm-transport cli` or `--llm-transport api`.',
    );
  }
  const sessionSeams =
    options.llm === 'agent'
      ? null
      : createGuardGenerateSessionSeams({
          repoRoot,
          ...(options.llm ? { transport: options.llm } : {}),
          ...(options.onRunStarted ? { onRunStarted: options.onRunStarted } : {}),
          // Single-step mode: the seams enforce the cache-only replay of every
          // step before the chosen one (the engine enforces the stop after it).
          ...(options.only ? { only: options.only } : {}),
        });
  const extractSession = options.extractSession ?? sessionSeams!.extractSession;
  const flowsAreaSession = options.flowsAreaSession ?? sessionSeams!.flowsAreaSession;
  const flowsEpicSession = options.flowsEpicSession ?? sessionSeams!.flowsEpicSession;
  const flowWorkerSession = options.flowWorkerSession ?? sessionSeams!.flowWorkerSession;

  tracker?.start('index');
  try {
    const guard = await generateGuards({
      repoRoot,
      transport: resolveTransport(options),
      models: resolveGuardModels(repoRoot, mode),
      executor: getGuardExecutor(),
      // The require-a-recipe gate — but ONLY where a user could have run `guard setup`.
      // A hosted/EE generate works in an ephemeral checkout nobody has a terminal
      // in, so it keeps deriving its own recipe exactly as it always has.
      requireExistingRecipe: guardsMaterializeInPlace(),
      recipeRunner: options.recipeRunner,
      matchRunner: options.matchRunner,
      extractSession,
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
            // cli and api places itself now (plan item 102), and a hand-authored
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
      onPlan: (total, work) => {
        // Indexing is an instant deterministic pass — mark it done with its result
        // detail immediately (recipe-discovery usage rides its tag), never a live phase.
        tracker?.done('index', withUsage('index', `${work} of ${total} section${total === 1 ? '' : 's'} changed`));
        cur = STEPS.indexOf('extract');
        // No detail yet — the seam's initial onDoc(0, total) supplies the
        // "docs 0/N" counter the moment the pool is planned.
        tracker?.start('extract');
      },
      onExtractProgress: (done, total) => {
        advanceTo('extract');
        if (done >= total) {
          tracker?.done('extract', `${total} doc${total === 1 ? '' : 's'}`);
        } else {
          // The session path's live counter. The one-shot path plans views
          // upfront (extractViewsTotal > 0) and keeps its finer per-view line.
          tracker?.detail('extract', withUsage('extract', `docs ${done}/${total}`));
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
          tracker?.done('flows', withUsage('flows', `${total} area${total === 1 ? '' : 's'}`));
        } else {
          tracker?.detail('flows', withUsage('flows', `areas ${done}/${total}`));
        }
      },
      onMatchProgress: (done, total) => {
        advanceTo('match');
        if (done >= total) {
          tracker?.done('match', withUsage('match', `${total} flow×surface`));
        } else {
          tracker?.detail('match', withUsage('match', `${done}/${total} flow×surface`));
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
      onFlowSettled: (settled, total) => {
        building = false;
        flowsDone = settled;
        flowsTotal = total;
        // Gap-only flows settle without any worker running — only re-render a
        // LIVE validate line; never start the step early.
        if (validateStarted || settled > 0) renderValidate();
      },
    });

    // An early abort (no corpus, an unusable recipe, a stage that lost every LLM
    // call) ran NO phase past the one it died in: the step it died in takes the
    // error, and every later step stays
    // PENDING. Marking them done would print "Authoring — 0 tests written" and
    // "Birth-validating — 0/0 flows settled" for work that never happened, and the
    // dashboard popup (same steps payload) would tick them green.
    if (guard.status === 'no-docs' || guard.status === 'recipe-failed' || guard.status === 'llm-failed') {
      tracker?.error(STEPS[cur], firstLine(guard.reason) ?? 'aborted');
      // Single-step mode, before the final step: the same write gate as a clean
      // stop. This run could never have produced a whole generate's report, so
      // persisting one would overwrite the LAST FULL generate's `result.json`
      // (what `guard status` and the dashboard read) with a partial abort. The
      // caller still gets the failure — loudly, and non-zero.
      if (!options.only || options.only === 'worker') persistGuardReport(repoRoot, guard);
      return { guard };
    }

    // A single-step run stopped BEFORE the final step: close only the step that
    // actually opened (the CLI hands the tracker a reduced checklist, so the
    // later keys don't exist — and StepTracker no-ops on unknown keys anyway),
    // and persist NOTHING. `guard/result.json` describes a completed generate;
    // a partial run's counts would read as a whole one's.
    if (guard.stoppedAfter) {
      tracker?.done(STEPS[cur], `stopped after ${guard.stoppedAfter}`);
      return { guard, ...(sessionSeams?.runDir() ? { sessionsRunDir: sessionSeams.runDir()! } : {}) };
    }

    // Mark every remaining step done with a closing detail.
    for (let i = cur; i < STEPS.length; i++) tracker?.done(STEPS[i]);
    if (guard.noChanges) {
      tracker?.done('validate', 'nothing changed');
    } else {
      tracker?.done('author', `${guard.written.length} test${guard.written.length === 1 ? '' : 's'} written`);
      // Every authored test is committed, so the validate line reports the split:
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

    return { guard, ...(sessionSeams?.runDir() ? { sessionsRunDir: sessionSeams.runDir()! } : {}) };
  } catch (e) {
    tracker?.error(STEPS[cur], (e as Error).message);
    throw e;
  } finally {
    // Close the sessions-store run record (a no-op when no session ran — a
    // fully-cached or one-shot run created none).
    sessionSeams?.finish(false);
    if (llmLog) {
      setLlmCallSink(undefined);
      llmLog.finish(Date.now() - startedAt);
    }
  }
}

/** The first line of a (possibly multi-line, guided) abort reason — a step detail
 *  is one terminal row, and the full reason is printed by the caller. */
function firstLine(reason: string | undefined): string | undefined {
  return reason?.split('\n')[0]?.trim() || undefined;
}

/**
 * The guard LLM stages whose usage the report totals — the two remaining
 * ONE-SHOT transport stages. The session stages (extraction, flows, workers,
 * fidelity children) never reach the stage-usage sink: their spend lives in the
 * sessions store (`sessions/guard-generate/<runId>/`), so the persisted
 * `usage` row deliberately covers the transport half only.
 */
const GUARD_USAGE_STAGES = ['guard.recipe', 'guard.match'] as const;

/**
 * Sum the run's per-stage usage over the guard LLM stages. Returns `undefined`
 * when no real call landed (a noChanges no-op, cache-only run, or the `agent`
 * transport which records nothing) so the report stays a clean superset.
 */
function sumGuardUsage(): GuardGenerateUsage | undefined {
  const usage = getStageUsage();
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const stage of GUARD_USAGE_STAGES) {
    const u = usage.get(stage);
    if (!u) continue;
    calls += u.calls;
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    costUsd += u.costUsd;
  }
  return calls > 0 ? { calls, inputTokens, outputTokens, costUsd } : undefined;
}

/**
 * Persist the generate report, carrying forward the PRIOR report's birth findings
 * for committed failing tests this generate did not re-execute (see
 * `carryForwardBirthFindings`) — without it, a cached/no-op regenerate wipes the
 * only record of what those red tests actually saw (expected/actual/evidence)
 * while the manifest still marks them failing. The prior report is read BEFORE
 * the write, off the same path.
 */
function persistGuardReport(repoRoot: string, guard: GuardGenerateResult): void {
  const report = buildGuardReport(guard, new Date().toISOString(), sumGuardUsage());
  writeGuardResult(
    repoRoot,
    carryForwardBirthFindings(report, readGuardResult(repoRoot), readManifest(repoRoot)),
  );
}

/**
 * Compose the persisted report from the generator result plus `generatedAt` and
 * the run's usage totals. Pure — the result is a superset of the generate result,
 * so the dashboard can build the same shape from an in-memory result.
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
 * snapshotted — surfaces render it live from the corpus. Used by EE onboarding to
 * record a needs-attention outcome without saving a scenario set; OSS never
 * persists it (the CLI throws the error and writes no report).
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

/** Stable step taxonomy for the guard run progress UI (CLI + dashboard). */
export const GUARD_RUN_STEPS = [
  { key: 'build', label: 'Building via recipe' },
  { key: 'run', label: 'Running scenarios' },
] as const;

export interface GuardRunInProcessOptions {
  tracker?: StepTracker;
  /** Restrict the run to a single scenario id (`--scenario`). */
  scenario?: string;
  /** Fires with each scenario's result as it settles — the CLI streams non-pass lines from it. */
  onScenarioResult?: (result: GuardScenarioResult) => void;
  /**
   * Override the visual judge for a failing web step. An injected judge always
   * wins (a test that must never reach a model passes its own, or one that
   * returns `null`). Unset, production gets {@link createGuardVisualJudge} — but
   * only when {@link guardVisualJudgeEnabled} says so: the judge is parked
   * (off by default) until its cost/value is settled.
   */
  visualJudge?: GuardVisualJudge;
}

/**
 * In-process driver for `truecourse guard run` — the guard analogue of the
 * curate/generate drivers. Resolves the repo ref, runs the committed scenarios
 * through the guard-runner, and drives a tracker through GUARD_RUN_STEPS (build →
 * run, with a live per-scenario counter) so the CLI terminal and the dashboard
 * popup show the same stream. Returns the runner's discriminated result untouched
 * — the caller decides how to present each status.
 *
 * Deterministic, with ONE opt-in annotation: when {@link guardVisualJudgeEnabled}
 * (off by default — the judge is parked), a failing WEB step's screenshot is shown
 * to a vision model, whose verdict is recorded beside the failure (see
 * {@link createGuardVisualJudge}). It cannot move an outcome and it never fires on
 * a green run, so a passing run is exactly as LLM-free as it always was. THIS is
 * the boundary the judge is wired at — the guard-runner takes it as an optional
 * callback, so every caller that does not come through here (birth validation, the
 * test suite, a hosted executor) runs with no judge and no model at all.
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
  // An injected judge always wins; the built one is gated on the opt-in flag.
  const visualJudge =
    options.visualJudge ?? (guardVisualJudgeEnabled() ? createGuardVisualJudge(repoRoot) : undefined);

  const result = mergeLoadErrors(
    await getGuardExecutor()({
      checkoutDir: repoRoot,
      recipe: loaded.recipe,
      scenarios: selected,
      // The `--scenario` filter was applied HERE, so the run has to be told what it
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
    tracker?.error('build', `Build failed (\`${result.build.command}\`)${result.build.timedOut ? ' — timed out' : ''}`);
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
 * What `truecourse guard recipe` renders: the recipe as the runner loads it, plus
 * the staleness the dashboard card already computes. `recipe` and `invalidReason`
 * are mutually exclusive and both null when no `recipe.json` exists;
 * `fingerprint`/`stale` come from {@link readGuardRecipeCard}, so the terminal and
 * the Scenarios tab can never disagree about whether the recipe drifted.
 */
export interface GuardRecipeView {
  /** Absolute path to `recipe.json` — printed whether or not the file exists. */
  path: string;
  /** The loaded recipe; null when absent OR unparseable (see `invalidReason`). */
  recipe: Recipe | null;
  /** The loader's own diagnostic when the file exists but does not parse. */
  invalidReason: string | null;
  /** `sha256:…` over the discovery inputs; null when there is no valid recipe. */
  fingerprint: string | null;
  /** True when the inputs moved since the last run's fingerprint; null with no run. */
  stale: boolean | null;
  /**
   * The credential `satisfies` verdict against the corpus's OpenAPI schemes (item
   * 56) — the SAME check `guard generate` fails on, surfaced while showing the
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
