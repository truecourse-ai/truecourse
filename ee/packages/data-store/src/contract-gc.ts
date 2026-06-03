/**
 * Garbage collection for content-addressed contract objects. Objects are
 * immutable and shared across commits, so reclaiming is a periodic mark-sweep,
 * never inline ref-counting (which would add a hot-path write and a lost-
 * decrement race). Per `(repoKey, kind)`:
 *
 *   1. mark  — union the object shas referenced by every live manifest row.
 *   2. sweep — `blob.list` the kind's object prefix and delete any object whose
 *              sha is unreferenced (and not explicitly protected).
 *
 * Orphans only appear once RETENTION deletes old `contract_sets` rows (a later
 * phase); until then every object is referenced and this is a no-op reclaimer.
 *
 * Race note: between a save's `blob.put(object)` and its manifest-row commit, an
 * object looks unreferenced. A lock-free grace needs per-object timestamps,
 * which `BlobStore` does not surface — so run GC when saves are quiescent (a
 * maintenance-window batch), or pass `protectedShas` (e.g. objects the save
 * layer just wrote) to shield in-flight content. Deleting a still-referenced
 * object would surface later as a `loadContracts` integrity error, so this
 * conservatism is deliberate.
 */

import { and, eq } from 'drizzle-orm';
import { contractSets, type EeDb } from '@truecourse/ee-db';
import type { BlobStore } from '@truecourse/ee-storage';
import type { ContractKind } from '@truecourse/core/lib/contract-store';
import { contractObjectPrefix } from './keys.js';

export interface GcResult {
  /** Object keys scanned under the prefix. */
  scanned: number;
  /** Live shas referenced by manifests. */
  live: number;
  /** Objects deleted. */
  deleted: number;
  /** The deleted object keys (for logging/metrics). */
  deletedKeys: string[];
}

export interface GcOptions {
  /** Shas (e.g. just-written, in-flight) never to sweep even if unreferenced. */
  protectedShas?: Set<string>;
}

interface Manifest {
  files?: Record<string, string>;
}

/** Mark-sweep the content-addressed objects for one `(repoKey, kind)`. */
export async function gcContractObjects(
  db: EeDb,
  blob: BlobStore,
  repoKey: string,
  kind: ContractKind,
  options: GcOptions = {},
): Promise<GcResult> {
  // mark: every sha any live manifest still points at.
  const live = new Set<string>();
  const rows = await db
    .select({ manifest: contractSets.manifest })
    .from(contractSets)
    .where(and(eq(contractSets.repoKey, repoKey), eq(contractSets.kind, kind)));
  for (const row of rows) {
    const files = (row.manifest as Manifest).files ?? {};
    for (const sha of Object.values(files)) live.add(sha);
  }

  // sweep: delete objects whose sha is neither live nor protected.
  const prefix = contractObjectPrefix(repoKey, kind);
  const keys = await blob.list(prefix);
  const protectedShas = options.protectedShas ?? new Set<string>();
  const deletedKeys: string[] = [];
  for (const key of keys) {
    const sha = key.slice(prefix.length);
    if (live.has(sha) || protectedShas.has(sha)) continue;
    await blob.delete(key);
    deletedKeys.push(key);
  }

  return { scanned: keys.length, live: live.size, deleted: deletedKeys.length, deletedKeys };
}
