import type { GuardSetupPreparationSession } from '@truecourse/guard-generator';
/**
 * In-process driver for Flow setup — the cheap preparation stage between the
 * Document scan and Flow generation.
 *
 * The ENGINE is `@truecourse/guard-generator`'s `runGuardSetup` (recipe discovery +
 * the live endpoint probe, detection, the catalog step with its externals skeleton,
 * the one seed — the step spine with per-step fingerprints). THIS module is the
 * adapter the dashboard calls: it owns step 0 (is a
 * provider configured — a CONFIG question, which the engine package deliberately
 * has no dependency on), model + transport resolution, the pre-flight cost
 * estimate, usage accounting, persisting `guard/setup.json`, and the AGENT-SESSION
 * seams: the recipe-repair, dependency-catalog, interfaces (reconcile + web-task
 * authoring), seed and auth-proof sessions are built here (they need the
 * configured session driver + the sessions store) and injected into the engine,
 * which stays core-free.
 *
 * Working-tree only, by design: setup writes files inside the repo. A hosted
 * caller runs it against a clone it materialized, and injects what a server owns
 * that a checkout does not — the workspace's transport and session driver, and
 * the repo identity its run record is keyed by.
 */

import {
  runGuardSetup,
  spawnRecipeRunner,
  GUARD_SETUP_STEPS,
  type GuardSetupOnlyStep,
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
  getStageUsage,
  resetStageUsage,
  setLlmCallSink,
  noProviderTransport,
  NO_LLM_PROVIDER_MESSAGE,
  type LlmTransport,
} from '@truecourse/shared/llm';
import type { RunError, SessionDriver } from '@truecourse/agent-loop';
import type { GuardSetupReport } from '@truecourse/shared';
import { createLlmCallLogger } from '../lib/llm-call-log.js';
import type { LlmTransportMode } from '../services/llm/provider-config.js';
import { resolveFallbackModel, resolveModel } from '../config/llm-models.js';
import { getModelPrices } from '../services/llm/model-prices.js';
import { estimateGuardSetup } from '../services/llm/spec-estimate.js';
import { mapInterfaces } from '../services/interface.service.js';
import { sessionRunDir, type SessionRunStartedInfo, type SessionRunStore } from '../lib/sessions-store.js';
import {
  AUTH_PROOF_SESSION_KIND,
  buildAuthProof,
  buildCatalogSession,
  buildInterfacesStep,
  buildRecipeRepair,
  buildSeedSession,
  buildPreparationSession,
  createGuardSetupSessionContext,
  DEPENDENCY_CATALOG_SESSION_KIND,
  RECIPE_REPAIR_SESSION_KIND,
  RECONCILE_INTERFACES_SESSION_KIND,
  SEED_SESSION_KIND,
  PREPARATION_SESSION_KIND,
} from '../services/guard-setup/index.js';
import { INTERFACE_AUTHOR_SESSION_KIND } from '../services/interface-author/index.js';
import { runGuardInterfaceAuthoring } from './guard-interfaces.js';
import type { LlmEstimate } from '../services/llm/token-estimator.js';
import { EstimateDeclined } from './spec-in-process.js';
import type { StepTracker } from '../progress.js';

export {
  GUARD_SETUP_STEPS,
  GUARD_SETUP_ONLY_STEPS,
  SetupStepNotReadyError,
  type GuardSetupOnlyStep,
} from '@truecourse/guard-generator';
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
   * The transport the ONE-SHOT calls run on: the one the dashboard server
   * built from the asking workspace's stored provider config, or the
   * operator's Claude Code. Credentials travel with the run, never through a
   * process-wide default, and the run has no other way to reach a model.
   */
  transport: LlmTransport;
  /**
   * The mode an explicit `transport`/`driver` runs in, which the run record's
   * attribution states. Unset, the run is on this process's Claude Code.
   */
  transportMode?: LlmTransportMode;
  /**
   * Run the SESSIONS on THIS driver instead of the configured one. Passing it
   * means passing `transportMode` too — the driver states what it calls, not
   * which mode selected it.
   */
  driver?: SessionDriver;
  /**
   * Where the run record and transcripts are keyed — the repo IDENTITY when
   * `repoRoot` is an ephemeral clone deleted after the run. Defaults to
   * `repoRoot`.
   */
  sessionsKey?: string;
  /**
   * The identity of the docker WORLD this repository's runs share, which the
   * recipe's compose project is named after: the workspace and the repository
   * together (`<org>/<owner>/<repo>`). It is NOT the sessions key: transcripts
   * are keyed per repository, while a compose project's volumes are what
   * `reset` wipes, and two workspaces connected to one repository run their
   * jobs side by side on one host. Absent ⇒ the clone directory's own name,
   * which is stable only for a developer's own tree.
   */
  composeKey?: string;
  /** Hosted lifecycle owns this run and its final result persistence. */
  sessionRun?: SessionRunStore;
  /**
   * Open the run record up front rather than on the first session, so a hosted
   * run is watchable from the moment it starts — including one that fails
   * before any session exists, or spends none at all.
   */
  eagerRun?: boolean;
  /** Re-derive the recipe and re-draft the seed even when both already exist. */
  refresh?: boolean;
  /** Interfaces step: re-author places that already carry authored tasks. */
  replace?: boolean;
  /**
   * A sessions-store run record just came into being — setup's own (on its first
   * session, or at once under `eagerRun`), so the caller learns the run's id.
   * A lazy run spending no session never fires it.
   */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
  /**
   * Single-step mode (`only`): run only this step —
   * prior steps replay from what they left on disk (a step nobody ran throws
   * {@link SetupStepNotReadyError}), later steps never start, and the persisted
   * `guard/setup.json` merges over the previous one. The estimate gate prices
   * only the chosen step.
   */
  only?: GuardSetupOnlyStep;
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
  /** Test seam for the recipe-repair session. */
  repair?: RecipeRepairFn;
  /** Test seam for the dependency-catalog session. */
  catalogSession?: GuardSetupCatalogSession;
  /** Test seam for the interfaces step (reconcile + authoring). */
  authorInterfaces?: GuardSetupInterfacesStep;
  /** Test seam for the seed session. */
  seedSession?: GuardSetupSeedSession;
  preparationSession?: GuardSetupPreparationSession;
  /** Test seam for the auth-proof step. */
  verifyAuth?: GuardSetupAuthStep;
}

export interface GuardSetupInProcessResult {
  report: GuardSetupReport;
  /** Absolute path of the persisted `guard/setup.json`. */
  reportPath: string;
  /**
   * Setup's scratch directory under the runtime dir, including interface
   * authoring sessions. Empty when no run was opened.
   */
  sessionsRunDirs: string[];
}

/**
 * STEP 0 — a usable LLM provider must exist. Cheap and call-free: the
 * no-provider sentinel is a hard refusal. A real transport is taken at its
 * word — the dashboard server probed the workspace's provider (or the
 * operator's Claude Code login) before it built the run, so there is nothing
 * left to check here.
 *
 * It runs FIRST because both of setup's LLM stages happen after real work (a build,
 * a boot, an analysis pass), and discovering "no provider" then would waste all of it.
 */
export function assertLlmProviderConfigured(transport: LlmTransport): void {
  if (transport === noProviderTransport) throw new NoLlmProviderError(NO_LLM_PROVIDER_MESSAGE);
}

/** The pre-flight estimate the gate prices the run with. */
export async function estimateGuardSetupCost(
  repoRoot: string,
  opts: {
    refresh?: boolean;
    replace?: boolean;
    /** The model the run's sessions will run on, when the caller knows it. */
    sessionModel?: string;
    /** Single-step mode: price ONLY this step's sessions. */
    only?: GuardSetupOnlyStep;
  } = {},
): Promise<LlmEstimate> {
  return estimateGuardSetup(repoRoot, await getModelPrices(), opts);
}

/**
 * The ONE-SHOT stage setup can still spend on: the legacy recipe fallback,
 * which fires only on runs without a session driver (an injected `recipeRunner`
 * test seam). The sessions' spend is
 * accounted separately — the loop's `BudgetSpent` has no input/output token
 * split, so it rides `usage.sessions` instead of being forced into these fields.
 */
const SETUP_USAGE_STAGES = ['guard.recipe'] as const;

/**
 * Which session kinds do each setup step's work — stamped onto the run
 * record's checklist so a surface reading run.json can file every session
 * under its step. `detect` is deterministic and owns no session.
 */
const GUARD_SETUP_STEP_SESSION_KINDS: Record<string, readonly string[]> = {
  recipe: [RECIPE_REPAIR_SESSION_KIND],
  detect: [],
  catalog: [DEPENDENCY_CATALOG_SESSION_KIND],
  interfaces: [RECONCILE_INTERFACES_SESSION_KIND, INTERFACE_AUTHOR_SESSION_KIND],
  seed: [SEED_SESSION_KIND],
  preparations: ['guard-setup.preparation-observations', PREPARATION_SESSION_KIND],
  auth: [AUTH_PROOF_SESSION_KIND],
};

export async function guardSetupInProcess(
  repoRoot: string,
  options: GuardSetupInProcessOptions,
): Promise<GuardSetupInProcessResult> {
  const { tracker } = options;
  // Step 0, before the estimate: never ask to spend, then fail on a missing
  // provider.
  const { transport } = options;
  assertLlmProviderConfigured(transport);
  const mode: LlmTransportMode = options.transportMode ?? 'claude-code';

  if (options.onLlmEstimate) {
    const estimate = await estimateGuardSetupCost(repoRoot, {
      ...(options.driver?.attribution.model ? { sessionModel: options.driver.attribution.model } : {}),
      ...(options.refresh ? { refresh: true } : {}),
      ...(options.replace ? { replace: true } : {}),
      ...(options.only ? { only: options.only } : {}),
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

  // THE SESSION SEAMS. Production wires the real agent sessions; a run with an
  // injected one-shot recipe runner (the test seam) keeps the legacy path those
  // tests drive. The context is LAZY by default — a run whose deterministic
  // paths settle everything never creates a run record and never builds a
  // driver — until a hosted caller asks for an eager one, which has a watcher
  // from the first second and must be visible even when it spends nothing.
  const sessionsAvailable = options.recipeRunner === undefined;
  const sessionContextOptions = {
    repoRoot,
    ...(options.sessionRun ? { run: options.sessionRun } : {}),
    stepSessionKinds: GUARD_SETUP_STEP_SESSION_KINDS,
    ...(options.sessionsKey ? { sessionsKey: options.sessionsKey } : {}),
    ...(options.tracker ? { tracker: options.tracker } : {}),
    ...(options.eagerRun ? { eager: true } : {}),
    ...(options.onRunStarted ? { onRunStarted: options.onRunStarted } : {}),
  };
  const sessionContext = !sessionsAvailable
    ? null
    : options.driver
      ? createGuardSetupSessionContext({
          ...sessionContextOptions,
          driver: options.driver,
          transportMode: mode,
        })
      : createGuardSetupSessionContext(sessionContextOptions);
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
          // Reuse setup's driver and persistence for the entire authoring step.
          author: async (authorOpts) => {
            const acquired = await sessionContext.acquire();
            const run = await runGuardInterfaceAuthoring({
              repoRoot: authorOpts.repoRoot,
              replace: authorOpts.replace,
              sessionRun: {
                runId: acquired.runId,
                dir: options.sessionRun?.dir ?? sessionRunDir(options.sessionsKey ?? repoRoot, 'guard-setup', acquired.runId),
                persistence: acquired.persistence,
              },
              driver: acquired.driver,
              transportMode: mode,
              transport,
              ...(options.signal ? { signal: options.signal } : {}),
              onStatus: (message) => tracker?.detail('interfaces', message),
            });
            return {
              runId: run.runId,
              authored: run.authored,
              skipped: run.skipped,
              places: run.places,
              diagnostics: run.diagnostics,
              spent: run.spent,
              ...(run.reconcile ? { reconcile: run.reconcile } : {}),
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
  const preparationSession = options.preparationSession ?? (sessionContext ? buildPreparationSession(sessionContext, { ...(options.signal ? { signal: options.signal } : {}) }) : undefined);
  const verifyAuth =
    options.verifyAuth ??
    (sessionContext
      ? buildAuthProof(sessionContext, {
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined);

  /** All setup sessions share one scratch directory. */
  const sessionsRunDirs = (): string[] => {
    const key = options.sessionsKey ?? repoRoot;
    const setupRunId = sessionContext?.runId();
    return [
      ...(setupRunId ? [sessionRunDir(key, 'guard-setup', setupRunId)] : []),
    ];
  };

  const steps = GUARD_SETUP_STEPS.map((s) => s.key as GuardSetupStepKey);
  let current = 0;
  const advanceTo = (key: GuardSetupStepKey): void => {
    const next = steps.indexOf(key);
    if (next < current) return;
    current = next;
    tracker?.start(key);
  };

  // Why the run record closes `failed` — a report the engine refused is the run
  // failing, whatever its sessions did. Hoisted because the `finally` that closes
  // the record cannot see the report.
  let closingFailure: RunError | null = null;

  try {
    const result: GuardSetupResult = await runGuardSetup({
      repoRoot,
      ...(options.composeKey ? { composeKey: options.composeKey } : {}),
      recipeRunner:
        options.recipeRunner ??
        spawnRecipeRunner({
          transport,
          model: resolveModel('guard.recipe'),
          fallbackModel: resolveFallbackModel() ?? undefined,
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
      ...(preparationSession ? { preparationSession } : {}),
      ...(verifyAuth ? { verifyAuth } : {}),
      ...(options.refresh ? { refresh: true } : {}),
      ...(options.replace ? { replace: true } : {}),
      ...(options.only ? { only: options.only } : {}),
      ...(options.confirmSeedReplace ? { confirmSeedReplace: options.confirmSeedReplace } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      onStep: (step) => advanceTo(step),
      onStepDone: (step, detail) => {
        advanceTo(step);
        tracker?.done(step, detail);
      },
      // The live phase inside a step — an install, a build, a boot, a model call.
      // A string the engine already composed, so the dashboard popup renders it
      // without knowing what a phase is.
      onStepDetail: (step, detail) => tracker?.detail(step, detail),
      // One line per thing the step did. They ride the checklist into the run
      // record, so a surface that never saw the process reads what setup did.
      onStepFact: (step, line) => tracker?.fact(step, line),
    });

    // A hard-gate failure ran NO later step: the step it died in takes the error and
    // every later one stays PENDING, so the checklist never ticks work that never ran.
    if (result.report.status === 'failed') {
      tracker?.error(steps[current], firstLine(result.report.reason) ?? 'aborted');
      closingFailure = { message: result.report.reason ?? 'guard setup failed', kind: 'setup' };
    } else {
      // A single-step run closes the checklist at the step it was asked for:
      // everything past it never started, so nothing past it may tick.
      const last = options.only ? steps.indexOf(options.only) + 1 : steps.length;
      for (let i = current; i < last; i++) tracker?.done(steps[i]);
    }

    const report: GuardSetupReport = {
      ...result.report,
      ...withUsage(sessionContext?.usageTotals() ?? null),
    };
    const reportPath = writeGuardSetup(repoRoot, report);
    return { report, reportPath, sessionsRunDirs: sessionsRunDirs() };
  } catch (e) {
    tracker?.error(steps[current], (e as Error).message);
    throw e;
  } finally {
    // Close the sessions-store run, when any session actually ran under it.
    await sessionContext?.finish(options.signal?.aborted === true, closingFailure ?? undefined);
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
