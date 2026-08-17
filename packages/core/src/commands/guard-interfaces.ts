/**
 * `guard interfaces` — the interface catalog's read view, and the AUTHORING run
 * that fills the half no derivation produces (SPEC_GUARD_PLAN item 104).
 *
 * The engine halves live where they belong: the derivation in
 * `services/interface.service.ts` (`mapInterfaces`), the authoring sessions in
 * `@truecourse/interface-author`. THIS module is the adapter both UIs call — it
 * resolves the run's context (which driver the configured transport selects,
 * where the transcripts go, which commit the run stands on) and hands the
 * package everything it needs, exactly as `guard-externals.ts` adapts the
 * externals engine.
 *
 * The sessions store is the standard one (§3.9): `sessions/guard-interfaces/
 * <runId>/`, a `run.json` index plus one transcript per session, reconciled on
 * boot like every other command's. A run that dies leaves a record that says so.
 */

import {
  authorWebInterfaces,
  planWorkItems,
  type AuthorProgress,
  type AuthorRunResult,
  type PlaceResult,
} from '@truecourse/interface-author';
import { readAuthoredInterfaceCatalog, readInterfaceCatalog } from '@truecourse/guard-runner';
import type { SessionEvent } from '@truecourse/agent-loop';
import path from 'node:path';
import { createSessionRun } from '../lib/sessions-store.js';
import { resolveCommitSha } from '../lib/repo-ref.js';
import { createConfiguredSessionDriver } from '../services/llm/session-driver.js';
import type { LlmTransportFlag } from '../config/global-config.js';

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
  /** Per-run transport flag; the saved selection answers otherwise. */
  transport?: LlmTransportFlag;
  signal?: AbortSignal;
  onProgress?: (event: AuthorProgress) => void;
  onSessionEvent?: (placeId: string, event: SessionEvent) => void;
}

export interface GuardInterfaceAuthorRun extends AuthorRunResult {
  runId: string;
  /** `<repo>/.truecourse/sessions/guard-interfaces/<runId>` — the transcripts. */
  runDir: string;
  /** Which backend ran the sessions, and on which model. */
  transport: { mode: string; model: string };
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
  const run = createSessionRun(repoRoot, { command: 'guard-interfaces', gitRef });
  const { driver, mode, model } = createConfiguredSessionDriver({
    ...(opts.transport ? { transport: opts.transport } : {}),
    cwd: repoRoot,
    providerStateDir: path.join(run.dir, 'provider'),
  });

  try {
    const result = await authorWebInterfaces({
      repoRoot,
      driver,
      persistence: run.persistence,
      ...(opts.places ? { places: opts.places } : {}),
      ...(opts.replace !== undefined ? { replace: opts.replace } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
    });
    run.finish(runStatus(result.places, opts.signal));
    return { ...result, runId: run.runId, runDir: run.dir, transport: { mode, model } };
  } catch (error) {
    run.finish('failed');
    throw error;
  }
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
