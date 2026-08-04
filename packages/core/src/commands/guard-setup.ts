/**
 * In-process driver for `truecourse guard setup` — the cheap preparation
 * stage between `spec scan` and `guard generate`.
 *
 * The ENGINE is `@truecourse/guard-generator`'s `runGuardSetup` (recipe discovery +
 * the live endpoint probe, detection, the externals skeleton, the one seed). THIS
 * module is the adapter both the CLI and (later) the dashboard call: it owns
 * step 0 (is a provider configured — a CONFIG question, which the engine package
 * deliberately has no dependency on), model + transport resolution, the pre-flight
 * cost estimate, usage accounting, and persisting `guard/setup.json`.
 *
 * Working-tree only, by design: setup writes files inside the repo. A hosted store
 * has no working tree, which is exactly why hosted `guard generate` keeps deriving
 * its own recipe rather than depending on this stage.
 */

import {
  runGuardSetup,
  spawnRecipeRunner,
  spawnSeedRunner,
  GUARD_SETUP_STEPS,
  type GuardSetupResult,
  type GuardSetupStepKey,
  type JourneyProvider,
  type RecipeRunner,
  type SeedRunner,
} from '@truecourse/guard-generator';
import { writeGuardSetup, readGuardSetup, guardSetupPath } from '@truecourse/guard-runner';
import {
  getDefaultTransport,
  agentTransport,
  cliTransport,
  getStageUsage,
  resetStageUsage,
  setLlmCallSink,
  isLlmConfigured,
  noProviderTransport,
  NO_LLM_PROVIDER_MESSAGE,
  type LlmTransport,
} from '@truecourse/shared/llm';
import { resolveClaudeBinary } from '@truecourse/shared';
import type { GuardSetupReport } from '@truecourse/shared';
import {
  LlmApiConfigError,
  createConfiguredApiTransport,
  getConfiguredLlmMode,
} from '../services/llm/install-transport.js';
import { isCliBinaryAvailable } from '../lib/cli-binary.js';
import { createLlmCallLogger } from '../lib/llm-call-log.js';
import { resolveFallbackModel, resolveModel } from '../config/llm-models.js';
import { getModelPrices } from '../services/llm/model-prices.js';
import { estimateGuardSetup } from '../services/llm/spec-estimate.js';
import { mapJourneys } from '../services/journey.service.js';
import type { LlmEstimate } from './analyze-core.js';
import { EstimateDeclined } from './spec-in-process.js';
import type { StepTracker } from '../progress.js';

export { GUARD_SETUP_STEPS } from '@truecourse/guard-generator';
export { EstimateDeclined } from './spec-in-process.js';
export { readGuardSetup, guardSetupPath } from '@truecourse/guard-runner';

/** No LLM provider is configured — setup's step 0, thrown before anything else runs. */
export class NoLlmProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoLlmProviderError';
  }
}

export interface GuardSetupInProcessOptions {
  tracker?: StepTracker;
  /**
   * LLM transport: `cli` (spawn `claude -p`), `agent` (mailbox under `io`), or
   * `api` (the provider configured in `~/.truecourse/config.json`). Unset
   * follows the saved selection.
   */
  llm?: 'cli' | 'agent' | 'api';
  io?: string;
  /** Re-derive the recipe and re-draft the seed even when both already exist. */
  refresh?: boolean;
  /**
   * Pre-flight cost gate. Called with the (bounded, at-most-two-stage) estimate
   * before any LLM work; return `false` to abort (throws {@link EstimateDeclined}).
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  /** Asked only when a refresh would REPLACE an existing `api.seed`; see the engine. */
  confirmSeedReplace?: () => Promise<boolean>;
  signal?: AbortSignal;
  // --- test seams (production spawns the transport) ---
  recipeRunner?: RecipeRunner;
  seedRunner?: SeedRunner;
  journeys?: JourneyProvider;
}

export interface GuardSetupInProcessResult {
  report: GuardSetupReport;
  /** Absolute path of the persisted `guard/setup.json`. */
  reportPath: string;
}

/**
 * STEP 0 — a usable LLM provider must exist. Cheap and call-free: the EE
 * no-provider sentinel is a hard refusal, and the Claude Code fallback (spawn the
 * `claude` CLI) only has to be ON PATH here — the CLI command additionally runs the
 * full auth round-trip, exactly as `guard generate` does.
 *
 * The `claude` binary is the LAST resort, reached only when the run resolved no
 * transport at all: in API mode {@link resolveTransport} answers from the saved
 * provider config, so this gate never looks for a binary that mode never spawns.
 *
 * It runs FIRST because both of setup's LLM stages happen after real work (a build,
 * a boot, an analysis pass), and discovering "no provider" then would waste all of it.
 */
export function assertLlmProviderConfigured(transport?: LlmTransport): void {
  if (transport) {
    if (transport === noProviderTransport) throw new NoLlmProviderError(NO_LLM_PROVIDER_MESSAGE);
    return;
  }
  if (getDefaultTransport() !== undefined) {
    if (!isLlmConfigured()) throw new NoLlmProviderError(NO_LLM_PROVIDER_MESSAGE);
    return;
  }
  const binary = resolveClaudeBinary();
  if (!isCliBinaryAvailable(binary)) {
    throw new NoLlmProviderError(
      `No LLM provider is configured: \`${binary}\` is not installed or not on your PATH. ` +
        'Install Claude Code (https://docs.anthropic.com/en/docs/claude-code), set CLAUDE_CODE_BINARY to its path, ' +
        'or configure a provider with `truecourse config`.',
    );
  }
}

/**
 * Build the LLM transport for a run — an explicit per-run override of the saved
 * selection. `agent` → the filesystem mailbox under `options.io`; `api` → the
 * direct-API transport from the user's global config (throws when it isn't
 * configured); `cli` → `claude -p`, forcing Claude Code even when an API
 * transport is the installed default; unset → the installed default.
 *
 * The unset case falls back to BUILDING the configured transport when API mode is
 * selected and nobody installed one: the stage models already come from that same
 * config (`resolveModel` → `llm.api.model`), so a transport that ignored it would
 * hand an API model name to `claude -p` — one config, read once, or not at all.
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
  const installed = getDefaultTransport();
  if (installed) return installed;
  return getConfiguredLlmMode() === 'api' ? createConfiguredApiTransport() : undefined;
}

/** The pre-flight estimate the CLI prompt renders — the SAME one the gate uses. */
export async function estimateGuardSetupCost(
  repoRoot: string,
  opts: { refresh?: boolean } = {},
): Promise<LlmEstimate> {
  return estimateGuardSetup(repoRoot, await getModelPrices(), opts);
}

/** The two LLM stages setup can spend on. */
const SETUP_USAGE_STAGES = ['guard.recipe', 'guard.seed'] as const;

export async function guardSetupInProcess(
  repoRoot: string,
  options: GuardSetupInProcessOptions = {},
): Promise<GuardSetupInProcessResult> {
  const { tracker } = options;
  // Step 0, before the estimate: never ask to spend, then fail on a missing
  // provider. In API mode the provider IS the saved config, so an unusable one is
  // the same refusal a missing `claude` binary is.
  let transport: LlmTransport | undefined;
  try {
    transport = resolveTransport(options);
  } catch (e) {
    if (e instanceof LlmApiConfigError) throw new NoLlmProviderError(e.message);
    throw e;
  }
  assertLlmProviderConfigured(transport);

  if (options.onLlmEstimate) {
    const estimate = await estimateGuardSetupCost(repoRoot, {
      ...(options.refresh ? { refresh: true } : {}),
    });
    if ((estimate.stages?.length ?? 0) > 0) {
      const proceed = await options.onLlmEstimate(estimate);
      if (!proceed) throw new EstimateDeclined('guard setup');
    }
  }

  resetStageUsage();
  const llmLog = createLlmCallLogger(repoRoot, 'guard-setup');
  if (llmLog) setLlmCallSink(llmLog.sink);
  const startedAt = Date.now();

  const steps = GUARD_SETUP_STEPS.map((s) => s.key as GuardSetupStepKey);
  let current = 0;
  const advanceTo = (key: GuardSetupStepKey): void => {
    const next = steps.indexOf(key);
    if (next < current) return;
    current = next;
    tracker?.start(key);
  };

  try {
    const result: GuardSetupResult = await runGuardSetup({
      repoRoot,
      recipeRunner:
        options.recipeRunner ??
        spawnRecipeRunner({
          transport,
          model: resolveModel('guard.recipe', undefined, repoRoot),
          fallbackModel: resolveFallbackModel(repoRoot) ?? undefined,
        }),
      seedRunner:
        options.seedRunner ??
        spawnSeedRunner({
          transport,
          model: resolveModel('guard.seed', undefined, repoRoot),
          fallbackModel: resolveFallbackModel(repoRoot) ?? undefined,
        }),
      journeys:
        options.journeys ??
        (async () => {
          // ONE working-tree analysis feeds every step, exactly as generate does it.
          const mapped = await mapJourneys(repoRoot);
          return {
            journeys: mapped.catalog.journeys,
            externalServices: mapped.externalServices,
            database: mapped.database,
            datastoreUrls: mapped.datastoreUrls,
          };
        }),
      ...(options.refresh ? { refresh: true } : {}),
      ...(options.confirmSeedReplace ? { confirmSeedReplace: options.confirmSeedReplace } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      onStep: (step) => advanceTo(step),
      onStepDone: (step, detail) => {
        advanceTo(step);
        tracker?.done(step, detail);
      },
      // The live phase inside a step — an install, a build, a boot, a model call.
      // A string the engine already composed, so the terminal checklist and the
      // dashboard popup render it without either of them knowing what a phase is.
      onStepDetail: (step, detail) => tracker?.detail(step, detail),
    });

    // A hard-gate failure ran NO later step: the step it died in takes the error and
    // every later one stays PENDING, so the terminal never ticks work that never ran.
    if (result.report.status === 'failed') {
      tracker?.error(steps[current], firstLine(result.report.reason) ?? 'aborted');
    } else {
      for (let i = current; i < steps.length; i++) tracker?.done(steps[i]);
    }

    const report: GuardSetupReport = { ...result.report, ...withUsage() };
    const reportPath = writeGuardSetup(repoRoot, report);
    return { report, reportPath };
  } catch (e) {
    tracker?.error(steps[current], (e as Error).message);
    throw e;
  } finally {
    if (llmLog) {
      setLlmCallSink(undefined);
      llmLog.finish(Date.now() - startedAt);
    }
  }
}

/** Sum the run's usage over setup's two stages; omitted when no real call landed. */
function withUsage(): Pick<GuardSetupReport, 'usage'> {
  const usage = getStageUsage();
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const stage of SETUP_USAGE_STAGES) {
    const u = usage.get(stage);
    if (!u) continue;
    calls += u.calls;
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    costUsd += u.costUsd;
  }
  return calls > 0 ? { usage: { calls, inputTokens, outputTokens, costUsd } } : {};
}

function firstLine(reason: string | undefined): string | undefined {
  return reason?.split('\n')[0]?.trim() || undefined;
}
