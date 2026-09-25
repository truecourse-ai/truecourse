/**
 * THE INTERFACES STEP of `guard setup` — the seam body
 * the command adapter injects as `GuardSetupOptions.authorInterfaces`. Two
 * halves, in order:
 *
 * 1. RECONCILE. The cli union's tree-vs-probe disputes — and ONLY
 *    those: an `authored-place-not-derived` diagnostic is not a question a
 *    program run answers, so it never enters the session's list — go to the
 *    `guard-setup.reconcile-interfaces` session (cache-aware; an empty list
 *    spends zero sessions). Valid resolutions are applied to the IN-MEMORY
 *    catalog with `applyReconcileResolutions` and the corrected snapshot is
 *    written back over `guard/interfaces.json` BEFORE authoring reads it —
 *    facts only (phantom flags/commands come off), so the catalog stays
 *    deterministic and fingerprintable, and the diagnostics themselves never
 *    enter it. Resolutions whose subjects no longer match the briefed
 *    diagnostics (a cached outcome from a moved world) leave the catalog
 *    untouched. A reconcile failure is a NOTE on the step, never the step's
 *    verdict — the catalog simply stays exactly as the union built it.
 *
 * 2. AUTHOR. The web-task authoring run — the existing
 *    `guard interfaces author` engine, injected as a thunk so this module
 *    never imports the command layer. The run is handed a way to open the
 *    LIVE SCREENS when the step can stand the app up (`liveScreens`, the seam
 *    that installs, builds, seeds and serves it, then signs a browser in): the
 *    run opens it only when a screen's live fragment is not cached, and the
 *    step closes it right after the run, whatever the run made of itself. A
 *    world that could not be stood up is a note on the step row — the
 *    sessions author from source alone — never the step's verdict. The engine already decided the step
 *    should RUN (fingerprint moved, authored file absent, or `--replace`);
 *    what remains here is the cheap zero-work check: when the authoring ledger
 *    has settled every screen (and no replace or refresh was asked), no
 *    authoring run is started at all — a run record with zero sessions would be
 *    noise. A screen the ledger holds as unsettled is NOT work by itself, so
 *    the row names it and a person can ask for the refresh that retries it.
 *
 * An authoring failure fails the STEP only when EVERY session failed; one dead
 * session leaves a ledger row and the step settles around it (the engine's
 * contract stands: neither ever fails setup);
 * everything this step noticed — the cli disputes, the session's verdicts,
 * the catalog edits, and the authoring run's stale-place diagnostics — is
 * returned for the step ROW in `guard/setup.json`, which is where run
 * reporting lands (the catalog schema forbids storing it).
 */

import type { SessionEvent } from '@truecourse/agent-loop';
import type {
  GuardSetupInterfacesStep,
  GuardSetupInterfacesStepInput,
  GuardSetupInterfacesStepResult,
} from '@truecourse/guard-generator';
import {
  authoringViewsMoved,
  canObserveLiveScreens,
  computeRecipeFingerprint,
  authoringRecipeContract,
  guardInterfacesPath,
  recipeContractFingerprint,
  readAuthoredInterfaceCatalog,
  readInterfaceCatalog,
  resolveEntry,
  staleAuthoredPlaceDiagnostics,
  unsettledAuthoring,
} from '@truecourse/guard-runner';
import { isCreditsExhausted, type InterfacesFile, type MapperDiagnostic } from '@truecourse/shared';
import { atomicWriteJson } from '../../lib/atomic-write.js';
import { planWorkItems } from '../interface-author/author.js';
import type { LiveScreens } from '../interface-author/live-screen.js';
import {
  applyReconcileResolutions,
  runReconcileInterfacesSession,
  validateResolutions,
  type InterfaceResolution,
} from './reconcile-interfaces.js';
import { describeSessionFailure, type GuardSetupSessionContext } from './session-context.js';

/**
 * What the injected authoring thunk must report back — the slice of
 * `GuardInterfaceAuthorRun` this step records. A thunk (rather than an import
 * of `commands/guard-interfaces.ts`) so the service layer never depends on
 * the command layer.
 */
export interface InterfacesAuthorRun {
  runId: string;
  authored: number;
  /** Re-authored tasks whose key moved through a reworded label alone. */
  labelRekeys?: number;
  skipped: string[];
  places: {
    status: string;
    placeId?: string;
    problems?: string[];
    fromCache?: boolean;
    /** The screen's existing tasks its session retired, each with why. */
    retired?: { id: string; reason: string }[];
  }[];
  diagnostics: MapperDiagnostic[];
  spent: { turns: number; tokens: number; costUsd: number };
  /** The state reconciliation that closed the run, when anything was authored. */
  reconcile?: { problems: string[] };
}

export type InterfacesAuthorFn = (opts: {
  repoRoot: string;
  replace: boolean;
  /** Re-open the screens whose ledger row says they never settled. */
  refresh: boolean;
  /** Stands up the running app the sessions may observe; called at most once, only on a cache miss. */
  openLive?: () => Promise<LiveScreens | undefined>;
}) => Promise<InterfacesAuthorRun>;

/** What the live-screens seam hands back: the observer and its teardown, or why there is none. */
export type LiveScreensOpen =
  | { ok: true; live: LiveScreens; close(): Promise<void> }
  | { ok: false; reason: string };

export interface BuildInterfacesStepOptions {
  /** Runs the web-task authoring (production: `runGuardInterfaceAuthoring`). */
  author: InterfacesAuthorFn;
  /**
   * Stands the app up for the sessions to observe (production:
   * `openSetupLiveScreens`). Called at most once, by the authoring run, and only
   * when a screen's live fragment is not cached; absent ⇒ the sessions author
   * from source alone.
   */
  liveScreens?: (input: GuardSetupInterfacesStepInput) => Promise<LiveScreensOpen>;
  signal?: AbortSignal;
  onSessionEvent?: (workItem: string, event: SessionEvent) => void;
}

/** The cli dispute kinds the reconcile session can answer by running the program. */
function reconcilable(diagnostics: readonly MapperDiagnostic[]): MapperDiagnostic[] {
  return diagnostics.filter(
    (d) => d.surface === 'cli' && d.kind !== 'authored-place-not-derived',
  );
}

export function buildInterfacesStep(
  context: GuardSetupSessionContext,
  opts: BuildInterfacesStepOptions,
): GuardSetupInterfacesStep {
  return async (input) => {
    const notes: string[] = [];
    const recorded: Pick<
      GuardSetupInterfacesStepResult,
      'diagnostics' | 'resolutions' | 'changes' | 'reconcileFromCache'
    > = {};

    // ---- Half 1: reconcile the cli disputes. --------------------------------
    const disputes = reconcilable(input.diagnostics);
    if (disputes.length > 0) recorded.diagnostics = [...disputes];
    if (disputes.length > 0 && input.recipe.entry && input.recipe.entry.length > 0) {
      try {
        const reconcile = await runReconcile(context, input, disputes, opts);
        if (reconcile.note) notes.push(reconcile.note);
        if (reconcile.resolutions) recorded.resolutions = reconcile.resolutions;
        if (reconcile.changes && reconcile.changes.length > 0) recorded.changes = reconcile.changes;
        if (reconcile.fromCache !== undefined) recorded.reconcileFromCache = reconcile.fromCache;
      } catch (error) {
        if (isCreditsExhausted(error)) throw error;
        notes.push(`reconcile failed: ${message(error)}`);
      }
    } else if (disputes.length > 0) {
      notes.push(
        `${disputes.length} cli dispute(s) left unreconciled — the recipe declares no \`entry\` to observe the program with`,
      );
    }

    // ---- Half 2: author the web tasks. --------------------------------------
    // The cheap zero-work check first: when nothing would be selected, no run
    // record (and no analyzer context pass) is spent on an empty work list.
    const derived = readInterfaceCatalog(input.repoRoot);
    const authored = readAuthoredInterfaceCatalog(input.repoRoot);
    const stale = new Set(staleAuthoredPlaceDiagnostics(derived, authored).map((d) => d.subject));
    // A screen authored from source alone is work once the step can look at it live.
    const liveAvailable = opts.liveScreens !== undefined && (await canObserveLiveScreens(input.recipe));
    const planned = planWorkItems(derived, authored, authoringRecipeContract(input.repoRoot), {
      repoRoot: input.repoRoot,
      liveAvailable,
    });
    const workable = planned.filter(
      (item) =>
        !stale.has(item.place.id) &&
        (input.replace ||
          item.needsAuthoring ||
          (input.refresh && item.record !== undefined && unsettledAuthoring(item.record))),
    );
    // Screens the ledger holds as never settled: they are not work (their inputs
    // have not moved), so the row has to say they are there to be refreshed.
    const unsettledScreens = planned
      .filter((item) => item.record !== undefined && unsettledAuthoring(item.record))
      .map((item) => ({ place: item.place.id, reason: `authoring ${item.record!.status}` }));
    // A view the last context pass read that moved is work for the context
    // pass alone: it may find a component newly shared, and no screen's row
    // records the layouts.
    if (workable.length === 0 && !authoringViewsMoved(input.repoRoot, authored)) {
      return {
        status: 'ok',
        reason: joinNotes(
          unsettledScreens.length > 0
            ? `every derived screen has settled — ${unsettledScreens.length} of them unauthored, awaiting a refresh — zero sessions`
            : 'every derived screen already has authored tasks and established readable facts — zero sessions',
          notes,
        ),
        ...(unsettledScreens.length > 0 ? { failedScreens: unsettledScreens } : {}),
        // The reconcile session (when one ran) lives under the SETUP run.
        ...(context.runId() ? { sessionRunId: context.runId() } : {}),
        ...recorded,
      };
    }

    // The live screens, stood up the first time the run asks (a screen whose
    // live fragment is not cached) and torn down with the run. A world that
    // will not come up is a note, and the run goes ahead on source alone.
    const liveScreens = opts.liveScreens;
    let opened: LiveScreensOpen | undefined;
    const openLive = liveScreens
      ? async (): Promise<LiveScreens | undefined> => {
          if (!opened) {
            opened = await liveScreens(input);
            if (!opened.ok) notes.push(`screens not observed live: ${opened.reason}`);
            for (const [name, reason] of opened.ok ? opened.live.unobservable ?? [] : []) {
              notes.push(`screens not observed as \`${name}\`: ${reason}`);
            }
          }
          return opened.ok ? opened.live : undefined;
        }
      : undefined;
    try {
      const run = await opts.author({
        repoRoot: input.repoRoot,
        replace: input.replace,
        refresh: input.refresh,
        ...(openLive ? { openLive } : {}),
      });
      // A screen served from its cached fragment ran no session, so it is
      // neither counted nor noted: the run record would show work nobody did.
      const ran = run.places.filter((place) => !place.fromCache);
      context.addSpend(ran.length, run.spent);
      for (const place of ran) {
        context.note(place.status === 'failed' || place.status === 'rejected' ? 'failed' : 'completed');
      }
      // The stale-place reports ride the SAME step row as the cli disputes —
      // one diagnostics stream, and the setup report row is where it lands.
      if (run.diagnostics.length > 0) {
        recorded.diagnostics = [...(recorded.diagnostics ?? []), ...run.diagnostics];
      }
      const failed = run.places.filter((place) => place.status === 'failed' || place.status === 'rejected');
      const allFailed = run.places.length > 0 && failed.length === run.places.length;
      for (const place of failed) {
        notes.push(`${place.placeId ?? 'authoring session'}: ${place.problems?.join('; ') || place.status}`);
      }
      // A screen that failed carries a ledger row now, so the step has settled
      // its whole work list whatever each session made of it: one dead session
      // no longer holds the step open for every later run. A run where EVERY
      // session died is the exception — nothing was settled but the failure
      // itself — and it stays loud. A screen the ledger held as unsettled that
      // this run retried (a refresh, or its inputs moved) has this run's
      // outcome now, whichever way it went, so only the ones the run did not
      // touch are still awaiting a refresh.
      const failedScreens = [
        ...failed.map((place) => ({
          place: place.placeId ?? 'authoring session',
          ...(place.problems && place.problems.length > 0
            ? { reason: place.problems.join('; ') }
            : {}),
        })),
        ...unsettledScreens.filter(
          (screen) => !run.places.some((place) => place.placeId === screen.place),
        ),
      ];
      // The closing state reconciliation never fails the run (the tasks are
      // written), so what it could not do is said on the step row, not lost.
      for (const problem of run.reconcile?.problems ?? []) {
        notes.push(`state registry not reconciled: ${problem}`);
      }
      // A retired task leaves the catalog, and the scenarios grounded on it are
      // left exactly as they are: the row says which went, and why.
      for (const place of run.places) {
        for (const task of place.retired ?? []) notes.push(`retired ${task.id}: ${task.reason}`);
      }
      return {
        status: allFailed ? 'failed' : 'ok',
        reason: joinNotes(
          allFailed
            ? `every authoring session failed (${run.places.length} place(s))`
            : `authored ${run.authored} task(s) across ${run.places.length - failed.length} place(s)` +
              (run.places.length > ran.length ? `, ${run.places.length - ran.length} from cache` : ''),
          notes,
        ),
        sessionRunId: run.runId,
        ...(input.replace && run.labelRekeys !== undefined ? { labelRekeys: run.labelRekeys } : {}),
        ...(failedScreens.length > 0 ? { failedScreens } : {}),
        ...recorded,
      };
    } catch (error) {
      if (isCreditsExhausted(error)) throw error;
      context.note('failed');
      // Return the failure on the step so setup can continue its remaining work.
      return {
        status: 'failed',
        reason: joinNotes(`authoring failed: ${message(error)}`, notes),
        ...recorded,
      };
    } finally {
      if (opened?.ok) await opened.close();
    }
  };
}

/** The reconcile half: session (cache-aware) → validate → apply → rewrite. */
async function runReconcile(
  context: GuardSetupSessionContext,
  input: GuardSetupInterfacesStepInput,
  disputes: readonly MapperDiagnostic[],
  opts: BuildInterfacesStepOptions,
): Promise<{
  note?: string;
  resolutions?: InterfaceResolution[];
  changes?: string[];
  /** Whether the verdicts came out of the cache; absent when no outcome came back. */
  fromCache?: boolean;
}> {
  // The context's persistence exists only once a session actually runs, and a
  // cache hit must not create the run record — so the driver thunk (resolved
  // by the session runner BEFORE any transcript write) acquires it, and this
  // forwarder hands the writes through. `readEvents` before an acquire can
  // only be asked for a session that never wrote anything.
  let acquired: Awaited<ReturnType<GuardSetupSessionContext['acquire']>> | null = null;
  const persistence = {
    appendEvent: (sessionId: string, event: SessionEvent) =>
      acquired!.persistence.appendEvent(sessionId, event),
    updateIndex: (entry: Parameters<
      Awaited<ReturnType<GuardSetupSessionContext['acquire']>>['persistence']['updateIndex']
    >[0]) => acquired!.persistence.updateIndex(entry),
    flush: async () => { await acquired?.persistence.flush?.(); },
    publishProgress: (sessionId: string, progress: import('@truecourse/agent-loop').SessionProgress) => acquired?.persistence.publishProgress?.(sessionId, progress),
    readEvents: (sessionId: string) => acquired?.persistence.readEvents(sessionId) ?? [],
  };

  const { outcome } = await runReconcileInterfacesSession({
    repoRoot: input.repoRoot,
    diagnostics: disputes,
    entry: resolveEntry(input.repoRoot, [...input.recipe.entry!]),
    // The cli disputes are settled by running the program, which the seed
    // never touches: the contract as it stood before the seed.
    recipeContract: recipeContractFingerprint(input.repoRoot, 'seed'),
    legacyRecipeFingerprint: computeRecipeFingerprint(input.repoRoot),
    driver: async () => {
      acquired = await context.acquire();
      return acquired.driver;
    },
    persistence,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.onSessionEvent
      ? { onSessionEvent: (event: SessionEvent) => opts.onSessionEvent?.('cli:reconcile', event) }
      : {}),
  });
  if (outcome === null) return {};
  if (outcome.status !== 'completed') {
    context.note('failed');
    context.addSpend(1, outcome.spent);
    return { note: `reconcile session: ${describeSessionFailure(outcome.failure)}` };
  }
  if (!outcome.fromCache) {
    context.note('completed');
    context.addSpend(1, outcome.spent);
  }

  // The fold's own validation — a cached outcome the diagnostics moved under
  // answers questions nobody asked; unknown-shaped answers leave the catalog
  // exactly as the union built it.
  const problems = validateResolutions(disputes, outcome.output.resolutions);
  if (problems.length > 0) {
    return {
      note: `reconcile resolutions ignored (${problems.length} mismatch(es) against the briefed disputes)`,
      resolutions: outcome.output.resolutions,
      fromCache: outcome.fromCache === true,
    };
  }

  const applied = applyReconcileResolutions({
    interfaces: input.interfaces,
    diagnostics: disputes,
    resolutions: outcome.output.resolutions,
  });
  if (applied.changes.length > 0) {
    // The corrected snapshot, written back BEFORE authoring (and everything
    // after it) reads the catalog. Only the `interfaces` list moves — the
    // registry, source and fingerprint fields stay the mapping's.
    const onDisk = readInterfaceCatalog(input.repoRoot);
    if (onDisk) {
      const corrected: InterfacesFile = { ...onDisk, interfaces: applied.interfaces };
      atomicWriteJson(guardInterfacesPath(input.repoRoot), corrected);
    }
  }
  return {
    resolutions: outcome.output.resolutions,
    changes: applied.changes,
    fromCache: outcome.fromCache === true,
  };
}

function joinNotes(head: string, notes: readonly string[]): string {
  return [head, ...notes].join(' · ');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
