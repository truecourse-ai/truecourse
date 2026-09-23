/**
 * `guard interfaces` — the interface catalog's read view, and the AUTHORING run
 * that fills the half no derivation produces.
 *
 * The engine halves live where they belong: the derivation in
 * `services/interface.service.ts` (`mapInterfaces`), the authoring sessions in
 * `services/interface-author/`. THIS module is the adapter both UIs call — it
 * resolves the run's context (which driver the configured transport selects,
 * where the transcripts go, which commit the run stands on) and hands the
 * package everything it needs, exactly as `guard-externals.ts` adapts the
 * externals engine.
 *
 * Standalone authoring opens its own run record, with one transcript per session
 * appended to its journal. Setup supplies its own run so authoring remains part
 * of the setup activity and lifecycle.
 *
 * The state reconciliation that closes a run is a session too — a ONE-TURN
 * one: the whole registry is its briefing, so it reads nothing, answers once,
 * and ends.
 */

import {
  appendInterfaceFindings,
  authorWebInterfaces,
  planWorkItems,
  reconcileAuthoredStates,
  STATE_RECONCILE_SESSION_KIND,
  StateReconcileResponseSchema,
  type AuthorProgress,
  type AuthorRunResult,
  type LiveScreens,
  type PlaceResult,
  type ReconcileComplete,
  type StateReconciliation,
} from '../services/interface-author/index.js';
import {
  readAuthoredInterfaceCatalog,
  readInterfaceCatalog,
  authoringRecipeContract,
} from '@truecourse/guard-runner';
import { CreditsExhaustedError, isCreditsPauseFailure } from '@truecourse/shared';
import type { SessionDriver, SessionEvent, SessionPersistence } from '@truecourse/agent-loop';
import path from 'node:path';
import { createStoredSessionRun, type SessionRunStartedInfo, type SessionRunStore } from '../lib/sessions-store.js';
import { resolveCommitSha } from '../lib/repo-ref.js';
import { createClaudeCodeSessionDriver } from '../services/llm/session-driver.js';
import { deriveWebAuthoringContext } from '../services/web-context.service.js';
import { runOneTurnSession, withOutcomeDelivery } from '../services/agent/one-turn.js';
import { describeSessionFailure } from '../services/guard-setup/session-context.js';
import type { LlmTransportMode } from '../services/llm/provider-config.js';

export interface GuardInterfacePlaceView {
  id: string;
  kind: string;
  title: string;
  address?: string;
  /** Tasks already authored at this place (directly or on a place it hosts). */
  authored: string[];
  /** Tasks or readable facts still need a source reading. */
  needsAuthoring: boolean;
}

export interface GuardInterfacesAuthorView {
  /** Every screen the catalog knows, with what is already authored on it. */
  places: GuardInterfacePlaceView[];
  /** Derived interfaces per surface — what the mapping produced. */
  derived: Record<string, number>;
  /** Authored interfaces per surface — what a human (or a session) wrote. */
  authored: Record<string, number>;
  /** True when no mapping has ever run: there is nothing to author against. */
  unmapped: boolean;
}

/**
 * The read-only view: which places exist, and which of them carry tasks. Free
 * and LLM-less, the way every `guard` read view is — it is also the work list
 * the authoring run would take, so the user can see the bill before paying it.
 */
export function readGuardInterfacesAuthorView(repoRoot: string): GuardInterfacesAuthorView {
  const derived = readInterfaceCatalog(repoRoot);
  const authored = readAuthoredInterfaceCatalog(repoRoot);
  return {
    places: planWorkItems(derived, authored, authoringRecipeContract(repoRoot), repoRoot).map((item) => ({
      id: item.place.id,
      kind: item.place.kind,
      title: item.place.title,
      ...(item.place.address ? { address: item.place.address } : {}),
      authored: item.existing,
      needsAuthoring: item.needsAuthoring,
    })),
    derived: countBySurface(derived?.interfaces ?? []),
    authored: countBySurface(authored?.interfaces ?? []),
    unmapped: derived === null,
  };
}

function countBySurface(interfaces: readonly { type: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const iface of interfaces) counts[iface.type] = (counts[iface.type] ?? 0) + 1;
  return counts;
}

export interface RunGuardInterfaceAuthorOptions {
  repoRoot: string;
  /** Author only these places; default = every screen needing tasks or readable facts. */
  places?: readonly string[];
  /** Re-author places that already carry tasks. */
  replace?: boolean;
  /** Retry the screens whose last session never settled, whatever their inputs say. */
  refresh?: boolean;
  limit?: number;
  /** How many sessions run at once; the authoring default answers otherwise. */
  concurrency?: number;
  /**
   * Run the SESSIONS on THIS driver instead of this process's Claude Code.
   * Passing it means passing `transportMode` too — the driver states what it
   * calls, not which mode selected it.
   */
  driver?: SessionDriver;
  /** The mode an explicit `driver` runs in — the run record's attribution. */
  transportMode?: LlmTransportMode;
  /**
   * Where the run record and transcripts are keyed — the repo IDENTITY when
   * `repoRoot` is an ephemeral clone deleted after the run. Defaults to
   * `repoRoot`.
   */
  sessionsKey?: string;
  /** Reuse the caller's run and persistence; the caller owns its lifecycle. */
  sessionRun?: Pick<SessionRunStore, 'runId' | 'dir' | 'persistence'>;
  /** Stands up the running app the sessions may observe, on a cache miss; the caller tears it down. */
  openLive?: () => Promise<LiveScreens | undefined>;
  signal?: AbortSignal;
  onProgress?: (event: AuthorProgress) => void;
  onSessionEvent?: (placeId: string, event: SessionEvent) => void;
  /** What the run is doing before the first session starts — the context pass. */
  onStatus?: (message: string) => void;
  /** The sessions-store run record was just created — the caller learns the
   *  run's id from it. */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
}

export interface GuardInterfaceAuthorRun extends AuthorRunResult {
  runId: string;
  /** The run's scratch directory, including when the run is owned by setup. */
  runDir: string;
  /** Which backend ran the sessions, and on whose model — the same record the
   *  run.json carries and every transcript's `session-start` stamps. */
  transport: { mode: string; provider: string; model: string; fallbackModel?: string };
  /** The context pass: how much grounding the sessions were given. */
  context: { places: number; files: number; seconds: number };
  /**
   * The append to `guard/interfaces.findings.md` this run made — the doc-bug
   * feed the setup bundle carries, and how many bullets landed in it (the run's
   * findings with the duplicates of one discrepancy collapsed). Absent when no
   * session found one.
   */
  findingsLedger?: { path: string; appended: number };
  /**
   * The state reconciliation that closed the run, when there was
   * anything to reconcile. Absent when nothing was authored: a run that wrote no
   * task minted no state, and the registry is exactly what it already was.
   */
  reconcile?: StateReconciliation;
}

/**
 * Run the authoring. Every session's transcript lands on the run's journal
 * whatever the outcome. Standalone authoring closes its own run record:
 * `completed` when every session reached an outcome, `failed` when none did,
 * `interrupted` when the caller aborted.
 */
export async function runGuardInterfaceAuthoring(
  opts: RunGuardInterfaceAuthorOptions,
): Promise<GuardInterfaceAuthorRun> {
  const { repoRoot } = opts;
  const ownedRun = opts.sessionRun
    ? undefined
    : await createStoredSessionRun(opts.sessionsKey ?? repoRoot, {
        command: 'guard-interfaces',
        gitRef: await resolveCommitSha(repoRoot),
      });
  // Exactly one exists: the caller's run or the standalone run created above.
  const run = opts.sessionRun ?? ownedRun!;
  try {
    if (ownedRun) opts.onRunStarted?.({ command: 'guard-interfaces', runId: run.runId, dir: run.dir });
    // A caller hands over the workspace's own driver; otherwise the run is on
    // this process's Claude Code.
    const { driver, mode, attribution } = opts.driver
      ? {
          driver: opts.driver,
          mode: opts.transportMode ?? ('claude-code' as LlmTransportMode),
          attribution: opts.driver.attribution,
        }
      : createClaudeCodeSessionDriver({
          cwd: repoRoot,
          providerStateDir: path.join(run.dir, 'provider'),
        });
    // Which model answered is part of what a run MEANS: a transcript read after
    // a config change, or after a fallback swap, must not need the config of the
    // day to be interpretable.
    const llm = {
      mode,
      provider: attribution.provider,
      model: attribution.model,
      ...(attribution.fallbackModel ? { fallbackModel: attribution.fallbackModel } : {}),
    };
    ownedRun?.setLlm(llm);

    // The GROUNDING, once per run and amortised over every place in it:
    // the route module of each place, the modules it renders, and the api effects
    // its requests join to. One analyzer pass, so the sessions read instead of
    // rediscovering. It degrades to nothing rather than failing the run.
    opts.onStatus?.('reading the working tree');
    const context = await deriveWebAuthoringContext(repoRoot, { catalog: readInterfaceCatalog(repoRoot) });
    opts.onStatus?.(
      `context: ${context.contexts.size} place(s) grounded from ${context.files} file(s) in ${context.seconds}s`,
    );

    const result = await authorWebInterfaces({
      repoRoot,
      driver,
      persistence: run.persistence,
      context: context.contexts,
      ...(opts.openLive ? { openLive: opts.openLive } : {}),
      ...(opts.places ? { places: opts.places } : {}),
      ...(opts.replace !== undefined ? { replace: opts.replace } : {}),
      ...(opts.refresh !== undefined ? { refresh: opts.refresh } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
    });
    // THE LEDGER: what the sessions read in the source that the docs
    // and the derivations contradict. It is appended under this run's id, before
    // anything else can fail — a reconciliation that throws must not cost the
    // findings, which are about the repository rather than about the run.
    const findings = appendInterfaceFindings({
      repoRoot,
      runId: run.runId,
      findings: result.findings,
    });

    // THE CLOSING PASS: the sessions ran without seeing each other, so
    // the states they minted say one world several ways. Reconciling here — one
    // call, after the last fold — is what makes the registry a vocabulary
    // without any session needing to know what its peers were doing. It never
    // fails the run: the tasks are already written, and a reconciliation that
    // could not run costs a re-run of this pass alone.
    let reconcile: StateReconciliation | undefined;
    if (result.authored > 0) {
      opts.onStatus?.('reconciling the state registry');
      reconcile = await reconcileAuthoredStates({
        repoRoot,
        complete: stateReconcileComplete(driver, run.persistence, opts.signal),
      });
    }

    ownedRun?.finish(runStatus(result.places, opts.signal));
    return {
      ...result,
      runId: run.runId,
      runDir: run.dir,
      transport: llm,
      context: { places: context.contexts.size, files: context.files, seconds: context.seconds },
      ...(findings ? { findingsLedger: findings } : {}),
      ...(reconcile ? { reconcile } : {}),
    };
  } catch (error) {
    ownedRun?.finish(opts.signal?.aborted ? 'interrupted' : 'failed', { error: { message: error instanceof Error ? error.message : String(error) } });
    throw error;
  } finally { await ownedRun?.flush?.(); }
}

export interface RunGuardInterfaceReconcileOptions {
  repoRoot: string;
  /** The driver the one reconciliation session runs on. */
  driver: SessionDriver;
  /** Where its transcript is journalled. */
  persistence: SessionPersistence;
  signal?: AbortSignal;
}

/**
 * Reconcile an EXISTING catalog's state registry without authoring anything.
 * The same pass the authoring run closes with, reachable on its own:
 * a catalog authored before this pass existed — or one whose registry drifted
 * apart over several partial runs — is fixed for one session.
 */
export async function runGuardInterfaceReconcile(
  opts: RunGuardInterfaceReconcileOptions,
): Promise<StateReconciliation> {
  return reconcileAuthoredStates({
    repoRoot: opts.repoRoot,
    complete: stateReconcileComplete(opts.driver, opts.persistence, opts.signal),
  });
}

/**
 * The reconciliation's one ask, as a ONE-TURN SESSION: the whole registry in,
 * the groups that name the same world out. It has nothing to look up — the
 * registry IS the briefing — so it takes one turn, on the run's own driver and
 * its own journal.
 *
 * A registry of 300 states is a long read and a long answer, which is what the
 * token ceiling is sized for.
 */
function stateReconcileComplete(
  driver: SessionDriver,
  persistence: SessionPersistence,
  signal?: AbortSignal,
): ReconcileComplete {
  return async (prompt) => {
    const outcome = await runOneTurnSession({
      session: {
        kind: STATE_RECONCILE_SESSION_KIND,
        title: 'State reconcile',
        systemPrompt: withOutcomeDelivery(prompt.system),
        outcomeSchema: StateReconcileResponseSchema,
        tokenCeiling: 300_000,
      },
      workItem: 'state registry',
      briefing: prompt.user,
      driver,
      persistence,
      ...(signal ? { signal } : {}),
    });
    if (outcome.status === 'completed') return outcome.output;
    if (isCreditsPauseFailure(outcome.failure)) throw new CreditsExhaustedError();
    throw new Error(describeSessionFailure(outcome.failure));
  };
}

/** Every session reached an outcome ⇒ completed; none did ⇒ failed. */
function runStatus(
  places: readonly PlaceResult[],
  signal?: AbortSignal,
): 'completed' | 'failed' | 'interrupted' {
  if (signal?.aborted) return 'interrupted';
  if (places.length > 0 && places.every((place) => place.status === 'failed' || place.status === 'rejected')) return 'failed';
  return 'completed';
}
