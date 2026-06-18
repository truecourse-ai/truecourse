/**
 * Postgres implementation of core's `AnalysisStore` — the hosted home for the
 * analyze ("Code Quality") engine's output. Each per-analysis snapshot, the
 * mutable LATEST + diff singletons, and the append-only history index are stored
 * as jsonb rows keyed by the repoKey the caller passes as `repoPath` (the repo
 * identity, e.g. `owner/repo`). Mirrors the file store's semantics exactly — see
 * `@truecourse/core/lib/analysis-store`.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { analyses, analysisCurrent, analysisHistory, type EeDb } from '@truecourse/ee-db';
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

type CurrentKind = 'latest' | 'diff';

export class PgAnalysisStore implements AnalysisStore {
  constructor(private readonly db: EeDb) {}

  // ---- mutable per-repo singletons (LATEST / diff) ----

  private async readCurrent<T>(repoKey: string, kind: CurrentKind): Promise<T | null> {
    const [row] = await this.db
      .select({ body: analysisCurrent.body })
      .from(analysisCurrent)
      .where(and(eq(analysisCurrent.repoKey, repoKey), eq(analysisCurrent.kind, kind)))
      .limit(1);
    return row ? (row.body as T) : null;
  }

  private async writeCurrent(repoKey: string, kind: CurrentKind, body: unknown): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(analysisCurrent)
      .values({ repoKey, kind, body, updatedAt: now })
      .onConflictDoUpdate({
        target: [analysisCurrent.repoKey, analysisCurrent.kind],
        set: { body, updatedAt: now },
      });
  }

  private async deleteCurrent(repoKey: string, kind: CurrentKind): Promise<void> {
    await this.db
      .delete(analysisCurrent)
      .where(and(eq(analysisCurrent.repoKey, repoKey), eq(analysisCurrent.kind, kind)));
  }

  readLatest(repoKey: string): Promise<LatestSnapshot | null> {
    return this.readCurrent<LatestSnapshot>(repoKey, 'latest');
  }
  writeLatest(repoKey: string, latest: LatestSnapshot): Promise<void> {
    return this.writeCurrent(repoKey, 'latest', latest);
  }
  deleteLatest(repoKey: string): Promise<void> {
    return this.deleteCurrent(repoKey, 'latest');
  }

  readDiff(repoKey: string): Promise<DiffSnapshot | null> {
    return this.readCurrent<DiffSnapshot>(repoKey, 'diff');
  }
  writeDiff(repoKey: string, diff: DiffSnapshot): Promise<void> {
    return this.writeCurrent(repoKey, 'diff', diff);
  }
  deleteDiff(repoKey: string): Promise<void> {
    return this.deleteCurrent(repoKey, 'diff');
  }

  // ---- per-analysis snapshots ----

  async writeAnalysis(repoKey: string, snapshot: AnalysisSnapshot): Promise<WrittenAnalysis> {
    const filename = buildAnalysisFilename(snapshot.id, snapshot.createdAt);
    await this.db
      .insert(analyses)
      .values({ repoKey, filename, analysisId: snapshot.id, snapshot, createdAt: snapshot.createdAt })
      .onConflictDoUpdate({
        target: [analyses.repoKey, analyses.filename],
        set: { analysisId: snapshot.id, snapshot, createdAt: snapshot.createdAt },
      });
    return { filename, snapshot };
  }

  async readAnalysis(repoKey: string, filename: string): Promise<AnalysisSnapshot | null> {
    const [row] = await this.db
      .select({ snapshot: analyses.snapshot })
      .from(analyses)
      .where(and(eq(analyses.repoKey, repoKey), eq(analyses.filename, filename)))
      .limit(1);
    return row ? (row.snapshot as AnalysisSnapshot) : null;
  }

  /** Filenames for the repo, oldest-first (ISO-prefixed → lexicographically sortable). */
  async listAnalyses(repoKey: string): Promise<string[]> {
    const rows = await this.db
      .select({ filename: analyses.filename })
      .from(analyses)
      .where(eq(analyses.repoKey, repoKey))
      .orderBy(asc(analyses.filename));
    return rows.map((r) => r.filename);
  }

  async findAnalysisFilename(repoKey: string, analysisId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ filename: analyses.filename })
      .from(analyses)
      .where(and(eq(analyses.repoKey, repoKey), eq(analyses.analysisId, analysisId)))
      .orderBy(desc(analyses.filename))
      .limit(1);
    return row ? row.filename : null;
  }

  async deleteAnalysis(repoKey: string, filename: string): Promise<void> {
    await this.db
      .delete(analyses)
      .where(and(eq(analyses.repoKey, repoKey), eq(analyses.filename, filename)));
  }

  // ---- append-only history index ----

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
}
