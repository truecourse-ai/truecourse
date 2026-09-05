/**
 * Spec set index for the hosted edition. Content-addressed: the immutable spec
 * bodies live once in `content` (deduped per repo scope), and this table holds
 * only the small per-set pointer rows that reference them by sha.
 *
 *   spec_sets — one immutable artifact body per row (corpus /
 *               inferredDecisions), keyed by (repo_key, commit_sha, artifact) → content_sha.
 *
 * The mutable resolution ledger (decisions) is NOT here — it's per-repo, not
 * per-commit, and lives inline in the `decisions` table.
 *
 *   spec_sources — the repo's registered web spec sources (the llms.txt sites
 *                  `spec source add` snapshots): one mutable registry row per
 *                  repo, the page bodies content-addressed in `content` under
 *                  the same spec scope by the hash the registry names.
 */

import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const specSets = pgTable(
  'spec_sets',
  {
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    artifact: text('artifact').notNull(), // 'corpus' | 'decisions' | 'inferredDecisions'
    /** sha into `content` (scope = repo_key) — the immutable artifact body. */
    contentSha: text('content_sha').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.commitSha, t.artifact] }),
    index('spec_sets_repo_artifact_created_idx').on(t.repoKey, t.artifact, t.createdAt),
  ],
);

export const specSources = pgTable('spec_sources', {
  repoKey: text('repo_key').primaryKey(),
  /** The `sources.json` registry as the engine writes it. */
  registry: jsonb('registry').notNull(),
  updatedAt: ts('updated_at').notNull(),
});
