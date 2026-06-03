/**
 * Contract + spec set indexes for the hosted edition. Contracts are stored
 * content-addressed in the `BlobStore` (one immutable object per unique `.tc`
 * file content, deduped per repo+kind); this table holds only the small per-set
 * MANIFEST (a `{relPath: sha}` map) + bookkeeping. Specs are two small JSON
 * documents stored inline as `jsonb` (no blob). Both keyed by the opaque
 * `repo_key` + the git `commit_sha` the set was produced at.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const contractSets = pgTable(
  'contract_sets',
  {
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    kind: text('kind').notNull(), // 'contracts' | 'contracts_inferred'
    /** `{ v: 1, files: { relPath: 'sha256-…' } }` — the set's content manifest. */
    manifest: jsonb('manifest').$type<unknown>().notNull(),
    /** sha256 over the canonical (sorted) manifest — stable set identity / GC mark. */
    manifestHash: text('manifest_hash').notNull(),
    fileCount: integer('file_count').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.commitSha, t.kind] }),
    index('contract_sets_repo_kind_created_idx').on(t.repoKey, t.kind, t.createdAt),
    index('contract_sets_repo_kind_hash_idx').on(t.repoKey, t.kind, t.manifestHash),
  ],
);

export const specSets = pgTable(
  'spec_sets',
  {
    repoKey: text('repo_key').notNull(),
    commitSha: text('commit_sha').notNull(),
    artifact: text('artifact').notNull(), // 'claims' | 'decisions'
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repoKey, t.commitSha, t.artifact] }),
    index('spec_sets_repo_artifact_created_idx').on(t.repoKey, t.artifact, t.createdAt),
  ],
);
