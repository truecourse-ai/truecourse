/**
 * Postgres + Blob implementation of core's `AnalysisStore`. Bulky snapshots
 * (`latest`, `diff`, per-analysis) live in the `BlobStore`; the small queryable
 * bits — the per-repo index of written snapshots and the append-only history —
 * live in ee-db (`analyses`, `analysis_history`). Keyed by the opaque
 * `repoKey` the caller passes as `repoPath`.
 *
 * Why split: listing/finding/history must be queryable and race-free under
 * concurrent hosted analyses, which a single blob-of-history cannot guarantee.
 * Appending history is a single INSERT (the file impl's read-modify-write of one
 * JSON file is exactly the race we're removing).
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { analyses, analysisHistory, type EeDb } from '@truecourse/ee-db';
import type { BlobStore } from '@truecourse/ee-storage';
import {
  buildAnalysisFilename,
  type AnalysisStore,
  type WrittenAnalysis,
} from '@truecourse/core/lib/analysis-store';
import type {
  AnalysisSnapshot,
  DiffSnapshot,
  History,
  HistoryEntry,
  LatestSnapshot,
} from '@truecourse/core/types/snapshot';
import { analysisKey, diffKey, latestKey } from './keys.js';
import { getJson, putJson } from './json-blob.js';

export class PgBlobAnalysisStore implements AnalysisStore {
  constructor(
    private readonly db: EeDb,
    private readonly blob: BlobStore,
  ) {}

  readLatest(repoKey: string): Promise<LatestSnapshot | null> {
    return getJson<LatestSnapshot>(this.blob, latestKey(repoKey));
  }

  writeLatest(repoKey: string, latest: LatestSnapshot): Promise<void> {
    return putJson(this.blob, latestKey(repoKey), latest);
  }

  deleteLatest(repoKey: string): Promise<void> {
    return this.blob.delete(latestKey(repoKey));
  }

  async writeAnalysis(repoKey: string, snapshot: AnalysisSnapshot): Promise<WrittenAnalysis> {
    const filename = buildAnalysisFilename(snapshot.id, snapshot.createdAt);
    await putJson(this.blob, analysisKey(repoKey, filename), snapshot);
    await this.db
      .insert(analyses)
      .values({ repoKey, filename, analysisId: snapshot.id, createdAt: snapshot.createdAt })
      .onConflictDoUpdate({
        target: [analyses.repoKey, analyses.filename],
        set: { analysisId: snapshot.id, createdAt: snapshot.createdAt },
      });
    return { filename, snapshot };
  }

  readAnalysis(repoKey: string, filename: string): Promise<AnalysisSnapshot | null> {
    return getJson<AnalysisSnapshot>(this.blob, analysisKey(repoKey, filename));
  }

  async listAnalyses(repoKey: string): Promise<string[]> {
    const rows = await this.db
      .select({ filename: analyses.filename })
      .from(analyses)
      .where(eq(analyses.repoKey, repoKey))
      .orderBy(asc(analyses.filename));
    return rows.map((r) => r.filename);
  }

  async findAnalysisFilename(repoKey: string, analysisId: string): Promise<string | null> {
    // Newest-first (filename is ISO-prefixed) to match the file impl's reverse scan.
    const rows = await this.db
      .select({ filename: analyses.filename })
      .from(analyses)
      .where(and(eq(analyses.repoKey, repoKey), eq(analyses.analysisId, analysisId)))
      .orderBy(desc(analyses.filename))
      .limit(1);
    return rows[0]?.filename ?? null;
  }

  async deleteAnalysis(repoKey: string, filename: string): Promise<void> {
    await this.blob.delete(analysisKey(repoKey, filename));
    await this.db
      .delete(analyses)
      .where(and(eq(analyses.repoKey, repoKey), eq(analyses.filename, filename)));
  }

  async readHistory(repoKey: string): Promise<History> {
    const rows = await this.db
      .select({ entry: analysisHistory.entry })
      .from(analysisHistory)
      .where(eq(analysisHistory.repoKey, repoKey))
      .orderBy(asc(analysisHistory.id));
    return { analyses: rows.map((r) => r.entry as HistoryEntry) };
  }

  async appendHistory(repoKey: string, entry: HistoryEntry): Promise<void> {
    await this.db
      .insert(analysisHistory)
      .values({ repoKey, analysisId: entry.id, entry, createdAt: entry.createdAt });
  }

  async removeFromHistory(repoKey: string, analysisId: string): Promise<void> {
    await this.db
      .delete(analysisHistory)
      .where(and(eq(analysisHistory.repoKey, repoKey), eq(analysisHistory.analysisId, analysisId)));
  }

  readDiff(repoKey: string): Promise<DiffSnapshot | null> {
    return getJson<DiffSnapshot>(this.blob, diffKey(repoKey));
  }

  writeDiff(repoKey: string, diff: DiffSnapshot): Promise<void> {
    return putJson(this.blob, diffKey(repoKey), diff);
  }

  deleteDiff(repoKey: string): Promise<void> {
    return this.blob.delete(diffKey(repoKey));
  }
}
