/**
 * Garbage collection for content-addressed contract objects. Objects are
 * immutable and shared across commits/kinds, so reclaiming is a periodic
 * mark-sweep, never inline ref-counting (which would add a hot-path write and a
 * lost-decrement race). Per repo:
 *
 *   1. mark  — union the object shas referenced by every live `contract_sets`
 *              manifest row for the repo (all kinds — they share one scope).
 *   2. sweep — delete every `content` row under the repo's contract scope whose
 *              sha is unreferenced (and not explicitly protected).
 *
 * Orphans only appear once RETENTION deletes old `contract_sets` rows (a later
 * phase); until then every object is referenced and this is a no-op reclaimer.
 *
 * Race note: between a save's content `put` and its manifest-row commit, an
 * object looks unreferenced. Run GC when saves are quiescent (a maintenance
 * batch), or pass `protectedShas` (e.g. objects the save layer just wrote) to
 * shield in-flight content — deleting a still-referenced object would surface
 * later as a `loadContracts` integrity error, so this conservatism is deliberate.
 */

import { eq } from 'drizzle-orm';
import { contractSets, type EeDb } from '@truecourse/ee-db';
import { ContentStore, contentScope } from './content-store.js';

export interface GcResult {
  /** Live shas referenced by manifests. */
  live: number;
  /** Objects deleted. */
  deleted: number;
}

export interface GcOptions {
  /** Shas (e.g. just-written, in-flight) never to sweep even if unreferenced. */
  protectedShas?: Set<string>;
}

interface Manifest {
  files?: Record<string, string>;
}

/** Mark-sweep the content-addressed contract objects for one repo. */
export async function gcContractObjects(
  db: EeDb,
  repoKey: string,
  options: GcOptions = {},
): Promise<GcResult> {
  // mark: every sha any live manifest still points at (+ protected in-flight).
  const live = new Set<string>(options.protectedShas ?? []);
  const rows = await db
    .select({ manifest: contractSets.manifest })
    .from(contractSets)
    .where(eq(contractSets.repoKey, repoKey));
  for (const row of rows) {
    const files = (row.manifest as Manifest).files ?? {};
    for (const sha of Object.values(files)) live.add(sha);
  }

  // sweep: delete repo contract objects no live manifest references.
  const deleted = await new ContentStore(db).gc(contentScope.contract(repoKey), live);
  return { live: live.size, deleted };
}
