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
 * The sessions store is the standard one: `sessions/guard-interfaces/
 * <runId>/`, a `run.json` index plus one transcript per session, reconciled on
 * boot like every other command's. A run that dies leaves a record that says so.
 *
 * One stage here is NOT a session: the state reconciliation that closes a run
 * is a single schema-bearing completion, so it resolves the ordinary
 * one-shot transport beside the session driver rather than through it.
 */

import {
  appendInterfaceFindings,
  authorWebInterfaces,
  planWorkItems,
  reconcileAuthoredStates,
  STATE_RECONCILE_STAGE,
  type AuthorProgress,
  type AuthorRunResult,
  type PlaceResult,
  type ReconcileComplete,
  type StateReconciliation,
} from '../services/interface-author/index.js';
import { readAuthoredInterfaceCatalog, readInterfaceCatalog } from '@truecourse/guard-runner';
import {
  cliTransport,
  extractJsonValue,
  getDefaultTransport,
  type LlmTransport,
} from '@truecourse/shared/llm';
import type { SessionDriver, SessionEvent } from '@truecourse/agent-loop';
import path from 'node:path';
import { createSessionRun, type SessionRunStartedInfo } from '../lib/sessions-store.js';
import { resolveCommitSha } from '../lib/repo-ref.js';
import {
  createConfiguredApiTransport,
  installConfiguredLlmTransport,
  createClaudeCodeTransport,
} from '../services/llm/install-transport.js';
import { createConfiguredSessionDriver } from '../services/llm/session-driver.js';
import { deriveWebAuthoringContext } from '../services/web-context.service.js';
import { resolveFallbackModel, resolveModel } from '../config/llm-models.js';
import {
  effectiveLlmMode,
  type LlmTransportFlag,
  type LlmTransportMode,
} from '../config/global-config.js';

export interface GuardInterfacePlaceView {
  id: string;
  kind: string;
  title: string;
  address?: string;
  /** Tasks already authored at this place (directly or on a place it hosts). */
  authored: string[];
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
    places: planWorkItems(derived, authored).map((item) => ({
      id: item.place.id,
      kind: item.place.kind,
      title: item.place.title,
      ...(item.place.address ? { address: item.place.address } : {}),
      authored: item.existing,
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
  /** Author only these places; default = every screen with nothing authored yet. */
  places?: readonly string[];
  /** Re-author places that already carry tasks. */
  replace?: boolean;
  limit?: number;
  /** How many sessions run at once; the authoring default answers otherwise. */
  concurrency?: number;
  /** Per-run transport flag; the saved selection answers otherwise. */
  transport?: LlmTransportFlag;
  /**
   * Run the SESSIONS on THIS driver instead of the configured one. Passing it
   * means passing `transportMode` too — the driver states what it calls, not
   * which mode selected it.
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
  signal?: AbortSignal;
  onProgress?: (event: AuthorProgress) => void;
  onSessionEvent?: (placeId: string, event: SessionEvent) => void;
  /** What the run is doing before the first session starts — the context pass. */
  onStatus?: (message: string) => void;
  /** The sessions-store run record was just created — the CLI prints the
   *  dashboard "watch live" deep link from it. */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
}

export interface GuardInterfaceAuthorRun extends AuthorRunResult {
  runId: string;
  /** `<repo>/.truecourse/sessions/guard-interfaces/<runId>` — the transcripts. */
  runDir: string;
  /** Which backend ran the sessions, and on whose model — the same record the
   *  run.json carries and every transcript's `session-start` stamps. */
  transport: { mode: string; provider: string; model: string; fallbackModel?: string };
  /** The context pass: how much grounding the sessions were given. */
  context: { places: number; files: number; seconds: number };
  /**
   * The append to `guard/interfaces.findings.md` this run made — the committed
   * doc-bug feed, and how many bullets landed in it (the run's findings with the
   * duplicates of one discrepancy collapsed). Absent when no session found one.
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
 * Run the authoring. Every session's transcript lands in the run directory
 * whatever the outcome, and the run record is closed with the honest status:
 * `completed` when every session reached an outcome, `failed` when none did,
 * `interrupted` when the caller aborted.
 */
export async function runGuardInterfaceAuthoring(
  opts: RunGuardInterfaceAuthorOptions,
): Promise<GuardInterfaceAuthorRun> {
  const { repoRoot } = opts;
  const gitRef = await resolveCommitSha(repoRoot);
  const run = createSessionRun(opts.sessionsKey ?? repoRoot, { command: 'guard-interfaces', gitRef });
  opts.onRunStarted?.({ command: 'guard-interfaces', runId: run.runId, dir: run.dir });
  // A hosted caller hands over the workspace's own driver; a checkout resolves
  // one from the saved config.
  const { driver, mode, attribution } = opts.driver
    ? {
        driver: opts.driver,
        mode: opts.transportMode ?? effectiveLlmMode(opts.transport),
        attribution: opts.driver.attribution,
      }
    : createConfiguredSessionDriver({
        ...(opts.transport ? { transport: opts.transport } : {}),
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
  run.setLlm(llm);

  // The GROUNDING, once per run and amortised over every place in it:
  // the route module of each place, the modules it renders, and the api effects
  // its requests join to. One analyzer pass, so the sessions read instead of
  // rediscovering. It degrades to nothing rather than failing the run.
  opts.onStatus?.('reading the working tree');
  const context = await deriveWebAuthoringContext(repoRoot, { catalog: readInterfaceCatalog(repoRoot) });
  opts.onStatus?.(
    `context: ${context.contexts.size} place(s) grounded from ${context.files} file(s) in ${context.seconds}s`,
  );

  try {
    const result = await authorWebInterfaces({
      repoRoot,
      driver,
      persistence: run.persistence,
      context: context.contexts,
      ...(opts.places ? { places: opts.places } : {}),
      ...(opts.replace !== undefined ? { replace: opts.replace } : {}),
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
        complete: stateReconcileComplete(repoRoot, opts.transport),
      });
    }

    run.finish(runStatus(result.places, opts.signal));
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
    run.finish('failed');
    throw error;
  }
}

export interface RunGuardInterfaceReconcileOptions {
  repoRoot: string;
  /** Per-run transport flag; the saved selection answers otherwise. */
  transport?: LlmTransportFlag;
}

/**
 * Reconcile an EXISTING catalog's state registry without authoring anything.
 * The same pass the authoring run closes with, reachable on its own:
 * a catalog authored before this pass existed — or one whose registry drifted
 * apart over several partial runs — is fixed for one call, and no session runs.
 */
export async function runGuardInterfaceReconcile(
  opts: RunGuardInterfaceReconcileOptions,
): Promise<StateReconciliation> {
  return reconcileAuthoredStates({
    repoRoot: opts.repoRoot,
    complete: stateReconcileComplete(opts.repoRoot, opts.transport),
  });
}

/**
 * The one-shot model call the reconciliation asks through. It is NOT the session
 * driver: this is a single schema-bearing completion with no tools and no
 * transcript, so it goes through the ordinary `LlmTransport` seam every other
 * one-shot stage uses — api mode's direct transport when that is configured, an
 * EE-injected default when one is installed, and `claude -p` otherwise.
 */
function stateReconcileComplete(repoRoot: string, flag?: LlmTransportFlag): ReconcileComplete {
  const mode = effectiveLlmMode(flag);
  const transport = oneShotTransport(flag);
  const model = resolveModel(STATE_RECONCILE_STAGE, undefined, repoRoot, mode);
  const fallbackModel = resolveFallbackModel(repoRoot, mode);
  return async (prompt, schema) => {
    const raw = await transport({
      id: STATE_RECONCILE_STAGE,
      stage: STATE_RECONCILE_STAGE,
      model,
      ...(fallbackModel ? { fallbackModel } : {}),
      system: prompt.system,
      user: prompt.user,
      responseFormat: 'json',
      schema,
      // One call over the whole registry — a 300-state list is a long read and a
      // long answer, so the ceiling is the authoring stages' order, not a view's.
      timeoutMs: 600_000,
    });
    return JSON.parse(extractJsonValue(raw));
  };
}

/** The transport a one-shot stage of this command resolves to. */
function oneShotTransport(flag?: LlmTransportFlag): LlmTransport {
  if (flag === 'api') return createConfiguredApiTransport();
  if (flag === 'cli') return cliTransport();
  installConfiguredLlmTransport();
  return getDefaultTransport() ?? createClaudeCodeTransport();
}

/** Every session reached an outcome ⇒ completed; none did ⇒ failed. */
function runStatus(
  places: readonly PlaceResult[],
  signal?: AbortSignal,
): 'completed' | 'failed' | 'interrupted' {
  if (signal?.aborted) return 'interrupted';
  if (places.length > 0 && places.every((place) => place.status === 'failed')) return 'failed';
  return 'completed';
}
