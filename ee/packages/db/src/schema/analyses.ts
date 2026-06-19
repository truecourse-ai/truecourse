/**
 * Hosted analyze ("Code Quality") storage — the EE home for the OSS analyze
 * engine's output (architecture graph + violations). Mirrors the file store's
 * three `.truecourse/` artifacts, keyed by the opaque repoKey the caller passes
 * as `repoPath`:
 *   - `analyses`         — per-analysis snapshots (the `analyses/<iso>_<uuid>.json` set)
 *   - `analysis_current` — the mutable LATEST + diff singletons (kind-keyed)
 *   - `analysis_history` — the append-only per-analysis summary index
 *
 * Snapshots are stored as jsonb directly (like `verify_snapshots`), not
 * content-addressed: each analysis is a fresh id, so cross-commit dedup buys
 * little.
 */

import {
  pgTable,
  text,
  jsonb,
  bigserial,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Per-analysis snapshots — the full `AnalysisSnapshot` as jsonb. */
export const analyses = pgTable(
  'analyses',
  {
    repoKey: text('repo_key').notNull(),
    filename: text('filename').notNull(),
    analysisId: text('analysis_id').notNull(),
    snapshot: jsonb('snapshot').$type<unknown>().notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.filename] }),
    index('analyses_repo_analysis_idx').on(t.repoKey, t.analysisId),
  ],
);

/**
 * Mutable per-repo singletons: the materialized LATEST view (`kind = 'latest'`)
 * and the current diff (`kind = 'diff'`). One row per (repo, kind).
 */
export const analysisCurrent = pgTable(
  'analysis_current',
  {
    repoKey: text('repo_key').notNull(),
    kind: text('kind').notNull(),
    body: jsonb('body').$type<unknown>().notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoKey, t.kind] })],
);

/** Append-only per-analysis summary index (the `history.json` equivalent). */
export const analysisHistory = pgTable(
  'analysis_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    repoKey: text('repo_key').notNull(),
    analysisId: text('analysis_id').notNull(),
    entry: jsonb('entry').$type<unknown>().notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('analysis_history_repo_idx').on(t.repoKey, t.id)],
);
