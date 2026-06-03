/**
 * Analysis + drift index/history tables for the hosted edition. The bulky
 * snapshots themselves live in the BlobStore (`@truecourse/ee-storage`); these
 * tables hold only the small, queryable bits: a per-repo index of written
 * snapshots (for list/find) and the append-only history. `latest`/`diff` are a
 * single blob each (no row needed). `repo_key` is the opaque per-repo identity
 * the caller passes (the seam's `repoPath`); `entry` is loosely typed so ee-db
 * stays a leaf — the adapter casts to the core domain types.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  bigserial,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const analyses = pgTable(
  'analyses',
  {
    repoKey: text('repo_key').notNull(),
    filename: text('filename').notNull(),
    analysisId: text('analysis_id').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.filename] }),
    index('analyses_repo_analysis_idx').on(t.repoKey, t.analysisId),
  ],
);

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

export const verifyRuns = pgTable(
  'verify_runs',
  {
    repoKey: text('repo_key').notNull(),
    filename: text('filename').notNull(),
    runId: text('run_id').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.filename] }),
    index('verify_runs_repo_run_idx').on(t.repoKey, t.runId),
  ],
);

export const verifyHistory = pgTable(
  'verify_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    repoKey: text('repo_key').notNull(),
    runId: text('run_id').notNull(),
    entry: jsonb('entry').$type<unknown>().notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('verify_history_repo_idx').on(t.repoKey, t.id)],
);
