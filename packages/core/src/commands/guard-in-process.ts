/**
 * In-process driver for `truecourse guard generate` — the spec-side analogue of
 * `curateInProcess`. Shared by the CLI and the dashboard so the estimate gate,
 * model resolution, transport selection, and progress wiring live in one place.
 *
 * Steps: index (deterministic section plan) → extract (whole-document claim
 * extraction) → author (batched scenario authoring) → validate (birth). Birth
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
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type FidelityRunner,
  type TriageRunner,
  type FlowsRunner,
  type FlowsEpicRunner,
  type MatchRunner,
  type InterfaceProvider,
  type AuthorFailure,
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
import { readGuardRecipeCard } from './guard-read.js';
import { readCorpus, readDecisions } from '@truecourse/spec-consolidator';
import type { LlmEstimate } from './analyze-core.js';
import { EstimateDeclined, stageUsageTag } from './spec-in-process.js';
import { withEstimatePhase, type EstimatePhase, type StepTracker } from '../progress.js';

export { EstimateDeclined } from './spec-in-process.js';
export type { AuthorFailure } from '@truecourse/guard-generator';

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
  { key: 'author', label: 'Authoring scenarios' },
  { key: 'validate', label: 'Birth-validating' },
] as const;

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
const GUARD_STEP_STAGES: Record<string, StageId[]> = {
  index: ['guard.recipe'],
  extract: ['guard.extract'],
  interfaces: [],
  flows: ['guard.flows'],
  match: ['guard.match'],
  author: ['guard.generate'],
  validate: ['guard.retry', 'guard.fidelity', 'guard.triage'],
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
   * Fired the moment an authoring attempt fails. The CLI surfaces it live and gains
   * a "· N failed" reading on the flow counter; the dashboard popup wires nothing,
   * so its counter is unchanged.
   */
  onAuthorFailure?: (failure: AuthorFailure) => void;
  /**
   * Progress surface for the estimate itself (it runs before the first pipeline
   * step, so the tracker can't carry it). The CLI resolves a spinner line above
   * the estimate panel; the dashboard passes `estimateStepPhase(tracker)`.
   */
  onEstimatePhase?: EstimatePhase;
  // --- test seams (production injects none; runners bypass the transport) ---
  extractRunner?: ExtractRunner;
  generateRunner?: GenerateRunner;
  recipeRunner?: RecipeRunner;
  fidelityRunner?: FidelityRunner;
  triageRunner?: TriageRunner;
  flowsRunner?: FlowsRunner;
  flowsEpicRunner?: FlowsEpicRunner;
  matchRunner?: MatchRunner;
  /** Interface mapping seam — defaults to the deterministic analyzer-backed mapper. */
  interfaces?: InterfaceProvider;
  /**
   * INTERNAL test seam: stop the pipeline after flow synthesis. Never exposed as a
   * command flag — a `--flows-only` review mode was considered and rejected;
   * curation is `dismissedFlows` and cost control is the estimate gate.
   */
  stopAfterFlows?: boolean;
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

function resolveGuardModels(repoRoot: string, mode: LlmTransportMode): GuardGenerateModels {
  return {
    extract: resolveModel('guard.extract', undefined, repoRoot, mode),
    flows: resolveModel('guard.flows', undefined, repoRoot, mode),
    match: resolveModel('guard.match', undefined, repoRoot, mode),
    generate: resolveModel('guard.generate', undefined, repoRoot, mode),
    retry: resolveModel('guard.retry', undefined, repoRoot, mode),
    fidelity: resolveModel('guard.fidelity', undefined, repoRoot, mode),
    triage: resolveModel('guard.triage', undefined, repoRoot, mode),
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
      estimateGuardTokens(repoRoot, prices, { mode }),
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

  // Grounding (real-CLI probe capture) runs per section batch BEFORE that batch's
  // authoring call — a sweep that can take minutes on a cold run. It rides the
  // author step's detail so the phase never looks idle: "grounding probes X/Y ·
  // authoring Z/W claims". The probe total grows as later sections enter grounding.
  // The extract step's planned view denominator — the generator announces it
  // via onExtractViewProgress(0, total) before the first view resolves; kept so
  // the completed line can report both units (docs read AND views called).
  let extractViewsTotal = 0;
  let authorDone = 0;
  let authorTotal = 0;
  let authorFinished = false;
  let groundCaptured = 0;
  let groundPlanned = 0;
  const authorDetail = (): string => {
    const flows = `${authorDone}/${authorTotal} flow scenario${authorTotal === 1 ? '' : 's'}`;
    const base = groundPlanned > 0 ? `grounding probes ${groundCaptured}/${groundPlanned} · authoring ${flows}` : flows;
    return withUsage('author', base);
  };

  // The validate step's detail LEADS with the flow denominator (the flows this run
  // has work for, ticking as each settles — monotonic, never fake-complete), then
  // the build phase / plain birth count / retry counter: "flows 3/8 · building…" →
  // "flows 3/8 · birth 9" → "flows 3/8 · birth 9 · retrying 1/2". Birth counts carry
  // no denominator — their total grows across rounds, reading as complete while
  // flows still settle. Retry re-authoring is LLM work (stage `guard.retry`), so the
  // live usage tag rides this line.
  let building = false;
  let birthDone = 0;
  let flowsDone = 0;
  let flowsTotal = 0;
  // Live authoring-failure surfacing is a CLI concern: only a caller that wires
  // `onAuthorFailure` gets the "· N failed" reading, so the dashboard popup's
  // counter is byte-identical to what it always was.
  const surfacesFailures = !!options.onAuthorFailure;
  const failedFlows = new Set<string>();
  let retrySeen = false;
  let retryDone = 0;
  let retryTotal = 0;
  // Fidelity review runs per green candidate in the settle flow — its
  // counter rides the validate line's detail (a monotonic "fidelity N", like birth).
  let fidelitySeen = false;
  let fidelityReviewed = 0;
  // Failing-test triage runs once per birth failure after every round —
  // a bounded counter on the validate line, since the total is known when it starts.
  let triageSeen = false;
  let triageDone = 0;
  let triageTotal = 0;
  // Isolated re-confirmation (layer d): api would-be birth findings are re-run alone
  // in a clean room to shed shared-state false negatives. The `confirm` phase carries
  // the ACTUAL number being isolated (api-only, capped), surfaced on the validate line
  // so the (failure-scaled) phase never looks like a hang.
  let confirming = 0;
  // Author and validate overlap under the per-section pipeline: birth for an early
  // section can begin while later sections are still authoring. renderValidate
  // therefore starts validate WITHOUT completing author (advanceTo('author') only
  // finishes the deterministic pre-steps); author completes on its own when the
  // last claim resolves (in onAuthorProgress).
  let validateStarted = false;
  const renderValidate = (): void => {
    advanceTo('author');
    if (!validateStarted) {
      tracker?.start('validate');
      validateStarted = true;
    }
    const flowsPart = surfacesFailures && failedFlows.size > 0
      ? `flows ${flowsDone}/${flowsTotal} · ${failedFlows.size} failed`
      : `flows ${flowsDone}/${flowsTotal}`;
    const parts = [flowsPart, building ? 'building…' : `birth ${birthDone}`];
    if (retrySeen) parts.push(`retrying ${retryDone}/${retryTotal}`);
    if (confirming > 0) parts.push(`confirming ${confirming}`);
    if (fidelitySeen) parts.push(`fidelity ${fidelityReviewed}`);
    if (triageSeen) parts.push(`triaging ${triageDone}/${triageTotal}`);
    tracker?.detail('validate', withUsage('validate', parts.join(' · ')));
  };

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
      extractRunner: options.extractRunner,
      generateRunner: options.generateRunner,
      recipeRunner: options.recipeRunner,
      fidelityRunner: options.fidelityRunner,
      triageRunner: options.triageRunner,
      flowsRunner: options.flowsRunner,
      flowsEpicRunner: options.flowsEpicRunner,
      matchRunner: options.matchRunner,
      interfaces:
        options.interfaces ??
        (async () => {
          // ONE working-tree analysis feeds every half: the interface catalog, the
          // repo's detected third-party dependencies, and the code-truth grounding
          // authoring needs.
          const mapped = await mapInterfaces(repoRoot);
          return {
            interfaces: mapped.catalog.interfaces,
            // The resource registry rides the same seam. Today's mapper derives
            // none (hand-authored catalogs carry them), so this is the snapshot's
            // registry whenever the catalog preserved one.
            ...(mapped.catalog.resources ? { resources: mapped.catalog.resources } : {}),
            externalServices: mapped.externalServices,
            database: mapped.database,
            datastoreUrls: mapped.datastoreUrls,
            requestContracts: mapped.requestContracts,
            outboundRequests: mapped.outboundRequests,
          };
        }),
      ...(options.stopAfterFlows ? { stopAfterFlows: true } : {}),
      onPlan: (total, work) => {
        // Indexing is an instant deterministic pass — mark it done with its result
        // detail immediately (recipe-discovery usage rides its tag), never a live phase.
        tracker?.done('index', withUsage('index', `${work} of ${total} section${total === 1 ? '' : 's'} changed`));
        cur = STEPS.indexOf('extract');
        // No detail yet — the generator's initial onExtractViewProgress(0, total)
        // supplies the "0/N views" counter as soon as the view plan is known.
        tracker?.start('extract');
      },
      onExtractViewProgress: (done, total) => {
        // The live extraction counter: views are the call unit (a chunked doc is
        // many parallel calls); docs alone can sit at 0/1 for minutes. The
        // denominator is planned upfront, so it's visible from the first tick.
        extractViewsTotal = total;
        advanceTo('extract');
        tracker?.detail('extract', withUsage('extract', `views ${done}/${total}`));
      },
      onExtractProgress: (done, total) => {
        advanceTo('extract');
        if (done >= total) {
          // Completed line keeps both units visible end to end: docs read AND views called.
          const docs = `${total} doc${total === 1 ? '' : 's'}`;
          const views = `${extractViewsTotal} view${extractViewsTotal === 1 ? '' : 's'}`;
          tracker?.done('extract', withUsage('extract', `${docs} · ${views}`));
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
      onAuthorProgress: (done, total) => {
        advanceTo('author');
        authorDone = done;
        authorTotal = total;
        // The author step ticks (grounding + claim counters) until the last claim
        // resolves, then completes — even if validate (early-section birth) is
        // already running concurrently. A completed step drops the grounding prefix.
        if (done >= total) {
          authorFinished = true;
          tracker?.done('author', withUsage('author', `${done}/${total} flow scenario${total === 1 ? '' : 's'}`));
        } else {
          tracker?.detail('author', authorDetail());
        }
      },
      onGroundProgress: (captured, planned) => {
        groundCaptured = captured;
        groundPlanned = planned;
        // Round-2 (retry) grounding fires after authoring finished — it rides the
        // validate step's retry counter, so never reopen the completed author line.
        if (authorFinished) return;
        advanceTo('author');
        tracker?.detail('author', authorDetail());
      },
      onBirthPhase: (phase, total) => {
        building = phase === 'build';
        if (phase === 'confirm') confirming = total ?? 0;
        renderValidate();
      },
      onBirthProgress: (done) => {
        building = false;
        birthDone = done;
        renderValidate();
      },
      onRetryProgress: (done, total) => {
        retrySeen = true;
        retryDone = done;
        retryTotal = total;
        renderValidate();
      },
      onFidelityProgress: (reviewed) => {
        fidelitySeen = true;
        fidelityReviewed = reviewed;
        // Reviews happen in the settle flow — only render a LIVE validate line.
        if (validateStarted) renderValidate();
      },
      onTriageProgress: (done, total) => {
        triageSeen = true;
        triageDone = done;
        triageTotal = total;
        // Triage runs after birth settles — the validate line is live by then.
        if (validateStarted) renderValidate();
      },
      onAuthorFailure: options.onAuthorFailure
        ? (failure) => {
            // Only a FINAL failure counts a flow as given up on — a corrective
            // re-ask is still in flight.
            if (!failure.willRetry) failedFlows.add(`${failure.flowId}\0${failure.surface}`);
            options.onAuthorFailure!(failure);
            if (validateStarted) renderValidate();
          }
        : undefined,
      onFlowSettled: (settled, total) => {
        flowsDone = settled;
        flowsTotal = total;
        // Gap-only flows settle without ever birthing — only re-render a LIVE
        // validate line; never start the birth step early.
        if (validateStarted) renderValidate();
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
      persistGuardReport(repoRoot, guard);
      return { guard };
    }

    // Mark every remaining step done with a closing detail.
    for (let i = cur; i < STEPS.length; i++) tracker?.done(STEPS[i]);
    if (guard.noChanges) {
      tracker?.done('validate', 'nothing changed');
    } else {
      tracker?.done(
        'author',
        withUsage('author', `${guard.written.length} test${guard.written.length === 1 ? '' : 's'} written`),
      );
      // Every authored test is committed, so the validate line reports the split:
      // how many landed green vs. red at birth.
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

    return { guard };
  } catch (e) {
    tracker?.error(STEPS[cur], (e as Error).message);
    throw e;
  } finally {
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

/** The guard LLM stages whose usage the report totals. */
const GUARD_USAGE_STAGES = [
  'guard.recipe',
  'guard.extract',
  'guard.flows',
  'guard.match',
  'guard.generate',
  'guard.retry',
  'guard.fidelity',
  'guard.triage',
] as const;

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
