/**
 * In-process driver for `truecourse guard setup` — the cheap preparation
 * stage between `spec scan` and `guard generate`.
 *
 * The ENGINE is `@truecourse/guard-generator`'s `runGuardSetup` (recipe discovery +
 * the live endpoint probe, detection, the catalog step with its externals skeleton,
 * the one seed — the §7.6 step spine with per-step fingerprints). THIS module is
 * the adapter both the CLI and (later) the dashboard call: it owns step 0 (is a
 * provider configured — a CONFIG question, which the engine package deliberately
 * has no dependency on), model + transport resolution, the pre-flight cost
 * estimate, usage accounting, persisting `guard/setup.json`, and the AGENT-SESSION
 * seams (plan 03): the recipe-repair, dependency-catalog, interfaces
 * (reconcile + web-task authoring), seed and auth-proof sessions are built here
 * (they need the configured session driver + the sessions store) and injected
 * into the engine, which stays core-free.
 *
 * Working-tree only, by design: setup writes files inside the repo. A hosted store
 * has no working tree, which is exactly why hosted `guard generate` keeps deriving
 * its own recipe rather than depending on this stage.
 */

import {
  runGuardSetup,
  spawnRecipeRunner,
  GUARD_SETUP_STEPS,
  type GuardSetupAuthStep,
  type GuardSetupCatalogSession,
  type GuardSetupInterfaceProvider,
  type GuardSetupInterfacesStep,
  type GuardSetupResult,
  type GuardSetupSeedSession,
  type GuardSetupStepKey,
  type RecipeRepairFn,
  type RecipeRunner,
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
import { effectiveLlmMode, type LlmTransportMode } from '../config/global-config.js';
import { resolveFallbackModel, resolveModel } from '../config/llm-models.js';
import { getModelPrices } from '../services/llm/model-prices.js';
import { estimateGuardSetup } from '../services/llm/spec-estimate.js';
import { mapInterfaces } from '../services/interface.service.js';
import {
  buildAuthProof,
  buildCatalogSession,
  buildInterfacesStep,
  buildRecipeRepair,
  buildSeedSession,
  createGuardSetupSessionContext,
} from '../services/guard-setup/index.js';
import { runGuardInterfaceAuthoring } from './guard-interfaces.js';
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
  /** Interfaces step: re-author places that already carry authored tasks. */
  replace?: boolean;
  /**
   * Pre-flight cost gate. Called with the session-modeled estimate before any
   * LLM work; return `false` to abort (throws {@link EstimateDeclined}).
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  /** Asked only when a refresh would REPLACE an existing `api.seed`; see the engine. */
  confirmSeedReplace?: () => Promise<boolean>;
  signal?: AbortSignal;
  // --- test seams (production spawns the transport / builds the sessions) ---
  recipeRunner?: RecipeRunner;
  interfaces?: GuardSetupInterfaceProvider;
  /** Test seam for the recipe-repair session (plan 03 step 9). */
  repair?: RecipeRepairFn;
  /** Test seam for the dependency-catalog session (plan 03 step 10). */
  catalogSession?: GuardSetupCatalogSession;
  /** Test seam for the interfaces step (plan 03 steps 11 + 12). */
  authorInterfaces?: GuardSetupInterfacesStep;
  /** Test seam for the seed session (plan 03 step 13). */
  seedSession?: GuardSetupSeedSession;
  /** Test seam for the auth-proof step (plan 03 step 14). */
  verifyAuth?: GuardSetupAuthStep;
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
 * The binary is demanded of exactly the runs that SPAWN it: one that resolved no
 * transport at all (the Claude Code fallback), and one whose resolved transport IS
 * `cliTransport` — an explicit `--llm-transport cli`. Resolving a transport is not
 * evidence the thing it spawns exists, and letting that count would move the missing
 * binary from step 0 to minutes later, after the install, build, boot and analysis
 * this gate exists to protect. In API mode {@link resolveTransport} answers from the
 * saved provider config, so this never looks for a binary that mode never spawns.
 *
 * It runs FIRST because both of setup's LLM stages happen after real work (a build,
 * a boot, an analysis pass), and discovering "no provider" then would waste all of it.
 */
export function assertLlmProviderConfigured(
  transport?: LlmTransport,
  opts: { spawnsClaudeCli?: boolean } = {},
): void {
  if (transport === noProviderTransport) throw new NoLlmProviderError(NO_LLM_PROVIDER_MESSAGE);
  if (transport) {
    if (!opts.spawnsClaudeCli) return;
  } else if (getDefaultTransport() !== undefined) {
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
 * selected and nobody installed one: the stage models come from that same config
 * (`resolveModel` → `llm.api.model`), so a transport that ignored it would hand an
 * API model name to `claude -p` — one config, read once, or not at all. The
 * converse is {@link effectiveLlmMode}: a `cli` flag moves model resolution off
 * the API config too, so the two never disagree.
 */
function resolveTransport(options: { llm?: 'cli' | 'agent' | 'api'; io?: string }): ResolvedSetupTransport {
  if (options.llm === 'agent') {
    if (!options.io) {
      throw new Error('--llm agent requires --io <dir> (the request/response mailbox directory)');
    }
    return { transport: agentTransport(options.io) };
  }
  if (options.llm === 'api') return { transport: createConfiguredApiTransport() };
  // The one resolved transport that still needs step 0's binary check: it spawns
  // `claude`, and a transport object is no evidence that binary exists.
  if (options.llm === 'cli') return { transport: cliTransport(), spawnsClaudeCli: true };
  const installed = getDefaultTransport();
  if (installed) return { transport: installed };
  return getConfiguredLlmMode() === 'api'
    ? { transport: createConfiguredApiTransport() }
    : // Nothing resolved — the run falls through to each runner's own `cliTransport()`.
      { spawnsClaudeCli: true };
}

/** What a run resolved, plus whether that answer is the `claude`-spawning transport. */
interface ResolvedSetupTransport {
  transport?: LlmTransport;
  spawnsClaudeCli?: boolean;
}

/** The pre-flight estimate the CLI prompt renders — the SAME one the gate uses. */
export async function estimateGuardSetupCost(
  repoRoot: string,
  opts: { refresh?: boolean; replace?: boolean; mode?: LlmTransportMode } = {},
): Promise<LlmEstimate> {
  return estimateGuardSetup(repoRoot, await getModelPrices(), opts);
}

/**
 * The ONE-SHOT stage setup can still spend on: the legacy recipe fallback,
 * which fires only on runs without a session driver (the `agent` mailbox
 * transport, or an injected `recipeRunner` test seam). The sessions' spend is
 * accounted separately — the loop's `BudgetSpent` has no input/output token
 * split, so it rides `usage.sessions` instead of being forced into these fields.
 */
const SETUP_USAGE_STAGES = ['guard.recipe'] as const;

export async function guardSetupInProcess(
  repoRoot: string,
  options: GuardSetupInProcessOptions = {},
): Promise<GuardSetupInProcessResult> {
  const { tracker } = options;
  // Step 0, before the estimate: never ask to spend, then fail on a missing
  // provider. In API mode the provider IS the saved config, so an unusable one is
  // the same refusal a missing `claude` binary is.
  let resolved: ResolvedSetupTransport;
  try {
    resolved = resolveTransport(options);
  } catch (e) {
    if (e instanceof LlmApiConfigError) throw new NoLlmProviderError(e.message);
    throw e;
  }
  const transport = resolved.transport;
  assertLlmProviderConfigured(transport, {
    ...(resolved.spawnsClaudeCli ? { spawnsClaudeCli: true } : {}),
  });
  // The transport this run actually uses decides the models — never the saved
  // selection a `--llm-transport` flag just overrode.
  const mode = effectiveLlmMode(options.llm);

  if (options.onLlmEstimate) {
    const estimate = await estimateGuardSetupCost(repoRoot, {
      mode,
      ...(options.refresh ? { refresh: true } : {}),
      ...(options.replace ? { replace: true } : {}),
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

  // THE SESSION SEAMS (plan 03 steps 9–14). Production wires the real agent
  // sessions; a run with an injected one-shot recipe runner (the test seam)
  // keeps the legacy path those tests drive, and the `agent` mailbox transport
  // has no session driver at all. The context is LAZY throughout — a run whose
  // deterministic paths settle everything never creates a run record and never
  // builds a driver.
  const sessionsAvailable = options.llm !== 'agent' && options.recipeRunner === undefined;
  const sessionContext = sessionsAvailable
    ? createGuardSetupSessionContext({
        repoRoot,
        ...(options.llm === 'cli' || options.llm === 'api' ? { transport: options.llm } : {}),
      })
    : null;
  const transportFlag = options.llm === 'cli' || options.llm === 'api' ? options.llm : undefined;
  const repair =
    options.repair ??
    (sessionContext
      ? buildRecipeRepair(sessionContext, {
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined);
  const catalogSession =
    options.catalogSession ??
    (sessionContext
      ? buildCatalogSession(sessionContext, {
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined);
  const authorInterfaces =
    options.authorInterfaces ??
    (sessionContext
      ? buildInterfacesStep(sessionContext, {
          // The authoring engine of `guard interfaces author`, verbatim — its
          // own sessions-store run (`sessions/guard-interfaces/…`), its
          // context pass, its findings ledger and closing reconciliation.
          author: async (authorOpts) => {
            const run = await runGuardInterfaceAuthoring({
              repoRoot: authorOpts.repoRoot,
              replace: authorOpts.replace,
              ...(transportFlag ? { transport: transportFlag } : {}),
              ...(options.signal ? { signal: options.signal } : {}),
              onStatus: (message) => tracker?.detail('interfaces', message),
            });
            return {
              runId: run.runId,
              authored: run.authored,
              skipped: run.skipped,
              places: run.places.map((place) => ({ status: place.status })),
              diagnostics: run.diagnostics,
              spent: run.spent,
            };
          },
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined);
  const seedSession =
    options.seedSession ??
    (sessionContext
      ? buildSeedSession(sessionContext, {
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined);
  const verifyAuth =
    options.verifyAuth ??
    (sessionContext
      ? buildAuthProof(sessionContext, {
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined);

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
          model: resolveModel('guard.recipe', undefined, repoRoot, mode),
          fallbackModel: resolveFallbackModel(repoRoot, mode) ?? undefined,
        }),
      interfaces:
        options.interfaces ??
        (async () => {
          // ONE working-tree analysis feeds every step, exactly as generate does it.
          const mapped = await mapInterfaces(repoRoot);
          return {
            interfaces: mapped.catalog.interfaces,
            externalServices: mapped.externalServices,
            database: mapped.database,
            datastoreUrls: mapped.datastoreUrls,
            // The cli union's tree-vs-probe disputes — run reporting for the
            // interfaces step's reconcile session, never snapshotted.
            diagnostics: mapped.diagnostics,
          };
        }),
      ...(repair ? { repair } : {}),
      ...(catalogSession ? { catalogSession } : {}),
      ...(authorInterfaces ? { authorInterfaces } : {}),
      ...(seedSession ? { seedSession } : {}),
      ...(verifyAuth ? { verifyAuth } : {}),
      ...(options.refresh ? { refresh: true } : {}),
      ...(options.replace ? { replace: true } : {}),
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

    const report: GuardSetupReport = {
      ...result.report,
      ...withUsage(sessionContext?.usageTotals() ?? null),
    };
    const reportPath = writeGuardSetup(repoRoot, report);
    return { report, reportPath };
  } catch (e) {
    tracker?.error(steps[current], (e as Error).message);
    throw e;
  } finally {
    // Close the sessions-store run, when any session actually ran under it.
    sessionContext?.finish(options.signal?.aborted === true);
    if (llmLog) {
      setLlmCallSink(undefined);
      llmLog.finish(Date.now() - startedAt);
    }
  }
}

/**
 * The run's spend: the one-shot stage usage (the legacy recipe fallback) plus
 * the agent-session totals the context accumulated. `costUsd` is the WHOLE
 * run; the sessions' turn/token detail rides its own block because the loop's
 * `BudgetSpent` has no input/output split to fold into the one-shot fields.
 * Omitted entirely when nothing was spent.
 */
function withUsage(
  sessions: { count: number; turns: number; tokens: number; costUsd: number } | null,
): Pick<GuardSetupReport, 'usage'> {
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
  if (calls === 0 && (sessions === null || sessions.count === 0)) return {};
  return {
    usage: {
      calls,
      inputTokens,
      outputTokens,
      costUsd: costUsd + (sessions?.costUsd ?? 0),
      ...(sessions && sessions.count > 0 ? { sessions } : {}),
    },
  };
}

function firstLine(reason: string | undefined): string | undefined {
  return reason?.split('\n')[0]?.trim() || undefined;
}
