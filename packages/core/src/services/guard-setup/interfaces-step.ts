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
 *    never imports the command layer. The engine already decided the step
 *    should RUN (fingerprint moved, authored file absent, or `--replace`);
 *    what remains here is the cheap zero-work check: when every screen
 *    already carries authored tasks (and no replace was asked), no authoring
 *    run is started at all — a run record with zero sessions would be noise.
 *
 * An authoring failure fails the STEP, never setup (the engine's contract);
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
  computeRecipeFingerprint,
  guardInterfacesPath,
  readAuthoredInterfaceCatalog,
  readInterfaceCatalog,
  resolveEntry,
  staleAuthoredPlaceDiagnostics,
} from '@truecourse/guard-runner';
import type { InterfacesFile, MapperDiagnostic } from '@truecourse/shared';
import { atomicWriteJson } from '../../lib/atomic-write.js';
import { planWorkItems } from '../interface-author/author.js';
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
  skipped: string[];
  places: { status: string }[];
  diagnostics: MapperDiagnostic[];
  spent: { turns: number; tokens: number; costUsd: number };
}

export type InterfacesAuthorFn = (opts: {
  repoRoot: string;
  replace: boolean;
}) => Promise<InterfacesAuthorRun>;

export interface BuildInterfacesStepOptions {
  /** Runs the web-task authoring (production: `runGuardInterfaceAuthoring`). */
  author: InterfacesAuthorFn;
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
    const recorded: Pick<GuardSetupInterfacesStepResult, 'diagnostics' | 'resolutions' | 'changes'> = {};

    // ---- Half 1: reconcile the cli disputes. --------------------------------
    const disputes = reconcilable(input.diagnostics);
    if (disputes.length > 0) recorded.diagnostics = [...disputes];
    if (disputes.length > 0 && input.recipe.entry && input.recipe.entry.length > 0) {
      try {
        const reconcile = await runReconcile(context, input, disputes, opts);
        if (reconcile.note) notes.push(reconcile.note);
        if (reconcile.resolutions) recorded.resolutions = reconcile.resolutions;
        if (reconcile.changes && reconcile.changes.length > 0) recorded.changes = reconcile.changes;
      } catch (error) {
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
    const workable = planWorkItems(derived, authored).filter(
      (item) => !stale.has(item.place.id) && (input.replace || item.existing.length === 0),
    );
    if (workable.length === 0) {
      return {
        status: 'ok',
        reason: joinNotes(
          'every derived screen already carries authored tasks — zero sessions',
          notes,
        ),
        // The reconcile session (when one ran) lives under the SETUP run.
        ...(context.runId() ? { sessionRunId: context.runId() } : {}),
        ...recorded,
      };
    }

    try {
      const run = await opts.author({ repoRoot: input.repoRoot, replace: input.replace });
      context.addSpend(run.places.length, run.spent);
      // The stale-place reports ride the SAME step row as the cli disputes —
      // one diagnostics stream, and the setup report row is where it lands.
      if (run.diagnostics.length > 0) {
        recorded.diagnostics = [...(recorded.diagnostics ?? []), ...run.diagnostics];
      }
      const allFailed =
        run.places.length > 0 && run.places.every((place) => place.status === 'failed');
      return {
        status: allFailed ? 'failed' : 'ok',
        reason: joinNotes(
          allFailed
            ? `every authoring session failed (${run.places.length} place(s))`
            : `authored ${run.authored} task(s) across ${run.places.length} place(s)`,
          notes,
        ),
        sessionRunId: run.runId,
        ...recorded,
      };
    } catch (error) {
      // An authoring failure fails the STEP, never setup (the engine's rule).
      return {
        status: 'failed',
        reason: joinNotes(`authoring failed: ${message(error)}`, notes),
        ...recorded,
      };
    }
  };
}

/** The reconcile half: session (cache-aware) → validate → apply → rewrite. */
async function runReconcile(
  context: GuardSetupSessionContext,
  input: GuardSetupInterfacesStepInput,
  disputes: readonly MapperDiagnostic[],
  opts: BuildInterfacesStepOptions,
): Promise<{ note?: string; resolutions?: InterfaceResolution[]; changes?: string[] }> {
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
    readEvents: (sessionId: string) => acquired?.persistence.readEvents(sessionId) ?? [],
  };

  const { outcome } = await runReconcileInterfacesSession({
    repoRoot: input.repoRoot,
    diagnostics: disputes,
    entry: resolveEntry(input.repoRoot, [...input.recipe.entry!]),
    recipeFingerprint: computeRecipeFingerprint(input.repoRoot),
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
  return { resolutions: outcome.output.resolutions, changes: applied.changes };
}

function joinNotes(head: string, notes: readonly string[]): string {
  return [head, ...notes].join(' · ');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
