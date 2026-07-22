/**
 * In-process driver for `truecourse guard generate` — the guard analogue of
 * `generateFromCorpusInProcess`. Shared by the CLI and (later) the dashboard so
 * the estimate gate, model resolution, transport selection, and progress wiring
 * live in one place.
 *
 * Steps: index (deterministic section plan) → extract (whole-document claim
 * extraction) → author (batched scenario authoring) → validate (birth). Birth
 * findings are NOT a failure — the driver surfaces them as work to review; only a
 * hard error (no docs, recipe discovery failed) is a non-success outcome.
 */

import {
  generateGuards,
  type GuardGenerateResult,
  type GuardGenerateModels,
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type FidelityRunner,
} from '@truecourse/guard-generator';
import {
  writeGuardResult,
  sourceGuardRunInputs,
  type RunGuardResult,
  type ScenarioLoadError,
} from '@truecourse/guard-runner';
import {
  openConflicts,
  type GuardGenerateReport,
  type GuardGenerateUsage,
  type GuardScenarioResult,
  type CorpusConflict,
} from '@truecourse/shared';
import { getGit } from '../lib/git.js';
import { getGuardExecutor } from '../lib/guard-executor.js';
import {
  agentTransport,
  getDefaultTransport,
  getStageUsage,
  resetStageUsage,
  setLlmCallSink,
  type LlmTransport,
} from '@truecourse/shared/llm';
import { resolveFallbackModel, resolveModel, type StageId } from '../config/llm-models.js';
import { createLlmCallLogger } from '../lib/llm-call-log.js';
import { getModelPrices } from '../services/llm/model-prices.js';
import { estimateGuardTokens } from '../services/llm/spec-estimate.js';
import { readCorpus, readDecisions } from '@truecourse/spec-consolidator';
import type { LlmEstimate } from './analyze-core.js';
import { EstimateDeclined, stageUsageTag } from './spec-in-process.js';
import type { StepTracker } from '../progress.js';

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
  { key: 'author', label: 'Authoring scenarios' },
  { key: 'validate', label: 'Birth-validating' },
] as const;

/**
 * Which LLM stage(s) each guard step covers — so a step line shows the model +
 * live tokens/$ of the work it's doing (the scan/contracts convention). Recipe
 * discovery rides `index` (the section-indexing window), extraction rides
 * `extract`, round-1 authoring rides `author` (stage `guard.generate`). Birth
 * EXECUTION is deterministic sandbox work, but the one evidence-retry per
 * birth-failed claim is a full re-author (stage `guard.retry`) AND every green
 * candidate's fidelity review (stage `guard.fidelity`) both happen in the settle
 * flow — their spend rides the `validate` line.
 */
const GUARD_STEP_STAGES: Record<string, StageId[]> = {
  index: ['guard.recipe'],
  extract: ['guard.extract'],
  author: ['guard.generate'],
  validate: ['guard.retry', 'guard.fidelity'],
};

export interface GuardGenerateInProcessOptions {
  tracker?: StepTracker;
  /** LLM transport: `cli` (default, spawn `claude -p`) or `agent` (mailbox under `io`). */
  llm?: 'cli' | 'agent';
  io?: string;
  /**
   * Pre-flight LLM cost estimate gate. Called with the token estimate before any
   * LLM work; return `false` to abort (throws {@link EstimateDeclined}). Skipped
   * when nothing changed (the estimate has no stages).
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  // --- test seams (production injects none; runners bypass the transport) ---
  extractRunner?: ExtractRunner;
  generateRunner?: GenerateRunner;
  recipeRunner?: RecipeRunner;
  fidelityRunner?: FidelityRunner;
}

/**
 * The pre-flight guard estimate the dashboard renders — the SAME
 * `estimateGuardTokens(repoRoot, prices)` the CLI prompt and the driver's own gate
 * use (deterministic token math + ceiling cost, cache-aware, "N of M sections
 * changed"). Exposed so the dashboard estimate route re-derives nothing.
 */
export async function estimateGuard(repoRoot: string): Promise<LlmEstimate> {
  return estimateGuardTokens(repoRoot, await getModelPrices());
}

function resolveGuardModels(repoRoot: string): GuardGenerateModels {
  return {
    extract: resolveModel('guard.extract', undefined, repoRoot),
    generate: resolveModel('guard.generate', undefined, repoRoot),
    retry: resolveModel('guard.retry', undefined, repoRoot),
    fidelity: resolveModel('guard.fidelity', undefined, repoRoot),
    recipe: resolveModel('guard.recipe', undefined, repoRoot),
    fallback: resolveFallbackModel(repoRoot) ?? undefined,
  };
}

function resolveTransport(options: { llm?: 'cli' | 'agent'; io?: string }): LlmTransport | undefined {
  if (options.llm === 'agent') {
    if (!options.io) {
      throw new Error('--llm agent requires --io <dir> (the request/response mailbox directory)');
    }
    return agentTransport(options.io);
  }
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

  // Hard-fail on unresolved spec conflicts BEFORE the estimate — never ask to
  // spend, then fail. Extracting both sides of an open overlap births noise.
  assertNoOpenConflicts(repoRoot);

  // Pre-flight cost estimate + confirm, before any LLM call. No stages ⇒ nothing
  // changed ⇒ skip the prompt and run the deterministic no-op. Decline → abort.
  if (options.onLlmEstimate) {
    const prices = await getModelPrices();
    const estimate = await estimateGuardTokens(repoRoot, prices);
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
  const withUsage = (key: string, base: string): string => `${base}${stageUsageTag(GUARD_STEP_STAGES[key] ?? [], repoRoot)}`;

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
    const claims = `${authorDone}/${authorTotal} claim${authorTotal === 1 ? '' : 's'}`;
    const base = groundPlanned > 0 ? `grounding probes ${groundCaptured}/${groundPlanned} · authoring ${claims}` : claims;
    return withUsage('author', base);
  };

  // The validate step's detail LEADS with the fixed work-section denominator
  // (known at indexing, ticking as sections settle — monotonic, never
  // fake-complete), then the build phase / plain birth count / retry counter:
  // "sections 21/28 · building…" → "sections 21/28 · birth 49" → "sections 21/28 ·
  // birth 49 · retrying 19/20". Birth counts carry no denominator — under the
  // per-section pipeline their total grows, reading as complete while sections
  // still settle. Retry re-authoring is LLM work (stage `guard.retry`), so the
  // live usage tag rides this line.
  let building = false;
  let birthDone = 0;
  let sectionsDone = 0;
  let sectionsTotal = 0;
  let retrySeen = false;
  let retryDone = 0;
  let retryTotal = 0;
  // Fidelity review (item 33) runs per green candidate in the settle flow — its
  // counter rides the validate line's detail (a monotonic "fidelity N", like birth).
  let fidelitySeen = false;
  let fidelityReviewed = 0;
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
    const parts = [`sections ${sectionsDone}/${sectionsTotal}`, building ? 'building…' : `birth ${birthDone}`];
    if (retrySeen) parts.push(`retrying ${retryDone}/${retryTotal}`);
    if (fidelitySeen) parts.push(`fidelity ${fidelityReviewed}`);
    tracker?.detail('validate', withUsage('validate', parts.join(' · ')));
  };

  tracker?.start('index');
  try {
    const guard = await generateGuards({
      repoRoot,
      transport: resolveTransport(options),
      models: resolveGuardModels(repoRoot),
      executor: getGuardExecutor(),
      extractRunner: options.extractRunner,
      generateRunner: options.generateRunner,
      recipeRunner: options.recipeRunner,
      fidelityRunner: options.fidelityRunner,
      onPlan: (total, work) => {
        // Indexing is an instant deterministic pass — mark it done with its result
        // detail immediately (recipe-discovery usage rides its tag), never a live phase.
        sectionsTotal = work;
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
      onAuthorProgress: (done, total) => {
        advanceTo('author');
        authorDone = done;
        authorTotal = total;
        // The author step ticks (grounding + claim counters) until the last claim
        // resolves, then completes — even if validate (early-section birth) is
        // already running concurrently. A completed step drops the grounding prefix.
        if (done >= total) {
          authorFinished = true;
          tracker?.done('author', withUsage('author', `${done}/${total} claim${total === 1 ? '' : 's'}`));
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
      onBirthPhase: (phase) => {
        building = phase === 'build';
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
      onSectionSettled: (settled, total) => {
        sectionsDone = settled;
        sectionsTotal = total;
        // Gap sections settle during extract/author — only re-render a LIVE
        // validate line; never start the birth step early.
        if (validateStarted) renderValidate();
      },
    });

    // Mark every remaining step done with a closing detail.
    for (let i = cur; i < STEPS.length; i++) tracker?.done(STEPS[i]);
    if (guard.noChanges) {
      tracker?.done('validate', 'nothing changed');
    } else {
      tracker?.done(
        'author',
        withUsage('author', `${guard.written.length} scenario${guard.written.length === 1 ? '' : 's'} written`),
      );
      const birthTag = guard.birthFindings.length
        ? ` · ${guard.birthFindings.length} birth finding${guard.birthFindings.length === 1 ? '' : 's'}`
        : '';
      // Print BOTH counts truthfully: scenarios that passed birth vs. scenarios
      // written (they diverge when a passing scenario's section didn't settle).
      tracker?.done('validate', `${guard.birthPassed} passed · ${guard.written.length} written${birthTag}`);
    }

    // Persist the last-generate report next to the scenarios it describes. Written
    // on every completed generate (including the noChanges no-op); NOT on a thrown
    // error, which never reaches here — the report describes a completed generate.
    writeGuardResult(repoRoot, buildGuardReport(guard, new Date().toISOString(), sumGuardUsage()));

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

/** The guard LLM stages whose usage the report totals. */
const GUARD_USAGE_STAGES = ['guard.recipe', 'guard.extract', 'guard.generate', 'guard.retry', 'guard.fidelity'] as const;

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
}

/**
 * In-process driver for `truecourse guard run` — the guard analogue of the
 * curate/generate drivers. Resolves the repo ref, runs the committed scenarios
 * through the guard-runner, and drives a tracker through GUARD_RUN_STEPS (build →
 * run, with a live per-scenario counter) so the CLI terminal and the dashboard
 * popup show the same stream. Deterministic and LLM-free. Returns the runner's
 * discriminated result untouched — the caller decides how to present each status.
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
  const { loaded, selected, loadErrors } = sourced;

  const result = mergeLoadErrors(
    await getGuardExecutor()({
      checkoutDir: repoRoot,
      recipe: loaded.recipe,
      scenarios: selected,
      branch,
      commit,
      persist: true,
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
  } else if (result.status === 'missing-credential-env') {
    // A declared api credential's env var is unset at run start — resolved in the
    // build phase, before any server boots; mark it errored so the spinner doesn't hang.
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
