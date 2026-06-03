/**
 * Postgres + Blob implementation of core's `VerifyStore` — the drift-side mirror
 * of `PgBlobAnalysisStore`. Snapshots (`verify/latest`, `verify/diff`, per-run)
 * live in the `BlobStore`; the run index + append-only history live in ee-db
 * (`verify_runs`, `verify_history`). Keyed by the opaque `repoKey`.
 */

import { and, asc, eq } from 'drizzle-orm';
import { verifyHistory, verifyRuns, type EeDb } from '@truecourse/ee-db';
import type { BlobStore } from '@truecourse/ee-storage';
import {
  buildVerifyRunFilename,
  type VerifyStore,
  type WrittenVerifyRun,
} from '@truecourse/core/lib/verify-store';
import {
  summarizeDrifts,
  type VerifyDiff,
  type VerifyHistory,
  type VerifyHistoryEntry,
  type VerifyLatest,
  type VerifyRunSnapshot,
} from '@truecourse/core/types/verify-snapshot';
import { verifyDiffKey, verifyLatestKey, verifyRunKey } from './keys.js';
import { getJson, putJson } from './json-blob.js';

/** Build the materialized LATEST view from a full run snapshot (mirrors the file impl). */
function materializeVerifyLatest(snap: VerifyRunSnapshot, filename: string): VerifyLatest {
  return {
    head: filename,
    run: {
      id: snap.id,
      verifiedAt: snap.verifiedAt,
      branch: snap.branch,
      commitHash: snap.commitHash,
      contractsDir: snap.contractsDir,
      codeDir: snap.codeDir,
    },
    artifactCount: snap.artifactCount,
    extractedOperationCount: snap.extractedOperationCount,
    drifts: snap.drifts,
    resolverErrors: snap.resolverErrors,
    unresolvedRefs: snap.unresolvedRefs,
    summary: summarizeDrifts(snap.drifts),
  };
}

export class PgBlobVerifyStore implements VerifyStore {
  constructor(
    private readonly db: EeDb,
    private readonly blob: BlobStore,
  ) {}

  readVerifyLatest(repoKey: string): Promise<VerifyLatest | null> {
    return getJson<VerifyLatest>(this.blob, verifyLatestKey(repoKey));
  }

  writeVerifyLatest(repoKey: string, latest: VerifyLatest): Promise<void> {
    return putJson(this.blob, verifyLatestKey(repoKey), latest);
  }

  deleteVerifyLatest(repoKey: string): Promise<void> {
    return this.blob.delete(verifyLatestKey(repoKey));
  }

  async writeVerifyRun(repoKey: string, snapshot: VerifyRunSnapshot): Promise<WrittenVerifyRun> {
    const filename = buildVerifyRunFilename(snapshot.id, snapshot.verifiedAt);
    await putJson(this.blob, verifyRunKey(repoKey, filename), snapshot);
    await this.db
      .insert(verifyRuns)
      .values({ repoKey, filename, runId: snapshot.id, createdAt: snapshot.verifiedAt })
      .onConflictDoUpdate({
        target: [verifyRuns.repoKey, verifyRuns.filename],
        set: { runId: snapshot.id, createdAt: snapshot.verifiedAt },
      });
    return { filename, snapshot };
  }

  readVerifyRun(repoKey: string, filename: string): Promise<VerifyRunSnapshot | null> {
    return getJson<VerifyRunSnapshot>(this.blob, verifyRunKey(repoKey, filename));
  }

  async listVerifyRuns(repoKey: string): Promise<string[]> {
    const rows = await this.db
      .select({ filename: verifyRuns.filename })
      .from(verifyRuns)
      .where(eq(verifyRuns.repoKey, repoKey))
      .orderBy(asc(verifyRuns.filename));
    return rows.map((r) => r.filename);
  }

  async readVerifyHistory(repoKey: string): Promise<VerifyHistory> {
    const rows = await this.db
      .select({ entry: verifyHistory.entry })
      .from(verifyHistory)
      .where(eq(verifyHistory.repoKey, repoKey))
      .orderBy(asc(verifyHistory.id));
    return { runs: rows.map((r) => r.entry as VerifyHistoryEntry) };
  }

  async appendVerifyHistory(repoKey: string, entry: VerifyHistoryEntry): Promise<void> {
    await this.db
      .insert(verifyHistory)
      .values({ repoKey, runId: entry.id, entry, createdAt: entry.verifiedAt });
  }

  async deleteVerifyRun(repoKey: string, runId: string): Promise<boolean> {
    const { runs } = await this.readVerifyHistory(repoKey);
    const entry = runs.find((r) => r.id === runId);
    if (!entry) return false;

    await this.blob.delete(verifyRunKey(repoKey, entry.filename));
    await this.db
      .delete(verifyRuns)
      .where(and(eq(verifyRuns.repoKey, repoKey), eq(verifyRuns.filename, entry.filename)));
    await this.db
      .delete(verifyHistory)
      .where(and(eq(verifyHistory.repoKey, repoKey), eq(verifyHistory.runId, runId)));

    const latest = await this.readVerifyLatest(repoKey);
    if (latest && latest.head === entry.filename) {
      // History is appended oldest-first, so the last remaining entry is newest.
      const remaining = runs.filter((r) => r.id !== runId);
      const newest = remaining[remaining.length - 1];
      const snap = newest ? await this.readVerifyRun(repoKey, newest.filename) : null;
      if (snap && newest) {
        await this.writeVerifyLatest(repoKey, materializeVerifyLatest(snap, newest.filename));
      } else {
        await this.deleteVerifyLatest(repoKey);
      }
      await this.deleteVerifyDiff(repoKey); // baseline moved (or gone) — any diff is obsolete
    }
    return true;
  }

  readVerifyDiff(repoKey: string): Promise<VerifyDiff | null> {
    return getJson<VerifyDiff>(this.blob, verifyDiffKey(repoKey));
  }

  writeVerifyDiff(repoKey: string, diff: VerifyDiff): Promise<void> {
    return putJson(this.blob, verifyDiffKey(repoKey), diff);
  }

  deleteVerifyDiff(repoKey: string): Promise<void> {
    return this.blob.delete(verifyDiffKey(repoKey));
  }
}
