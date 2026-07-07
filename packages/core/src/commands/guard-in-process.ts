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
} from '@truecourse/guard-generator';
import { writeGuardResult, runGuard, type RunGuardResult } from '@truecourse/guard-runner';
import type { GuardGenerateReport, GuardGenerateUsage } from '@truecourse/shared';
import { getGit } from '../lib/git.js';
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
import type { LlmEstimate } from './analyze-core.js';
import { EstimateDeclined, stageUsageTag } from './spec-in-process.js';
import type { StepTracker } from '../progress.js';

export { EstimateDeclined } from './spec-in-process.js';

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
 * `extract`, and both round-1 and retry authoring ride `author` (stage
 * `guard.generate`). Birth is deterministic sandbox work — no LLM stage.
 */
const GUARD_STEP_STAGES: Record<string, StageId[]> = {
  index: ['guard.recipe'],
  extract: ['guard.extract'],
  author: ['guard.generate'],
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

  // The validate step's detail composes the build phase, the per-scenario birth
  // counter, and the retry-authoring counter — so no sub-phase looks idle while it
  // runs: "building…" → "birth k/N" → "birth N/N · retrying failed claims R/T" →
  // (round-2 ticks fold back into the birth counter as its total grows).
  let building = false;
  let birthSeen = false;
  let birthDone = 0;
  let birthTotal = 0;
  let retrySeen = false;
  let retryDone = 0;
  let retryTotal = 0;
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
    const parts = [building ? 'building…' : `birth ${birthDone}/${birthTotal}`];
    if (retrySeen) parts.push(`retrying failed claims ${retryDone}/${retryTotal}`);
    tracker?.detail('validate', parts.join(' · '));
  };

  tracker?.start('index');
  try {
    const guard = await generateGuards({
      repoRoot,
      transport: resolveTransport(options),
      models: resolveGuardModels(repoRoot),
      extractRunner: options.extractRunner,
      generateRunner: options.generateRunner,
      recipeRunner: options.recipeRunner,
      onPlan: (total, work) => {
        // Indexing is an instant deterministic pass — mark it done with its result
        // detail immediately (recipe-discovery usage rides its tag), never a live phase.
        tracker?.done('index', withUsage('index', `${work} of ${total} section${total === 1 ? '' : 's'} changed`));
        cur = STEPS.indexOf('extract');
        tracker?.start('extract', `0 views`);
      },
      onExtractViewProgress: (done, total) => {
        // The live extraction counter: views are the call unit (a chunked doc is
        // many parallel calls); docs alone can sit at 0/1 for minutes.
        advanceTo('extract');
        tracker?.detail('extract', withUsage('extract', `${done}/${total} view${total === 1 ? '' : 's'}`));
      },
      onExtractProgress: (done, total) => {
        advanceTo('extract');
        if (done >= total) {
          tracker?.done('extract', withUsage('extract', `${total} doc${total === 1 ? '' : 's'}`));
        }
      },
      onAuthorProgress: (done, total) => {
        advanceTo('author');
        const detail = withUsage('author', `${done}/${total} claim${total === 1 ? '' : 's'}`);
        // The author step ticks until the last claim resolves, then completes —
        // even if validate (early-section birth) is already running concurrently.
        if (done >= total) tracker?.done('author', detail);
        else tracker?.detail('author', detail);
      },
      onBirthPhase: (phase, total) => {
        if (phase === 'build') {
          building = true;
        } else {
          building = false;
          if (!birthSeen && total !== undefined) birthTotal = total;
        }
        renderValidate();
      },
      onBirthProgress: (done, total) => {
        building = false;
        birthSeen = true;
        birthDone = done;
        birthTotal = total;
        renderValidate();
      },
      onRetryProgress: (done, total) => {
        retrySeen = true;
        retryDone = done;
        retryTotal = total;
        renderValidate();
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
const GUARD_USAGE_STAGES = ['guard.recipe', 'guard.extract', 'guard.generate'] as const;

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
  const result = await runGuard({
    repoRoot,
    scenarioId: options.scenario,
    branch,
    commit,
    onPhase: (phase, total) => {
      if (phase === 'build') tracker?.start('build');
      else {
        tracker?.done('build');
        tracker?.start('run', `0/${total} scenarios`);
      }
    },
    onScenarioSettled: (done, total) => tracker?.detail('run', `${done}/${total} scenarios`),
  });
  if (result.status === 'ok') {
    const n = result.latest.summary.total;
    tracker?.done('run', `${n} scenario${n === 1 ? '' : 's'}`);
  } else if (result.status === 'build-failed') {
    tracker?.error('build', `Build failed (\`${result.build.command}\`)${result.build.timedOut ? ' — timed out' : ''}`);
  }
  return result;
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
