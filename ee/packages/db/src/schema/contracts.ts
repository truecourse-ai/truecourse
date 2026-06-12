/**
 * Contract + spec set indexes for the hosted edition. Both are content-addressed:
 * the `.tc` / immutable-spec bodies live once in `content` (deduped per scope),
 * and these tables hold only the small per-set MANIFESTs that point in by sha.
 *
 *   contract_sets — `{relPath: sha}` map (many files per set), keyed by
 *                   (repo_key, commit_sha, kind).
 *   spec_sets     — one immutable artifact body per row (claims / scan-state /
 *                   chains), keyed by (repo_key, commit_sha, artifact) → content_sha.
 *
 * The mutable resolution ledger (decisions) is NOT here — it's per-repo, not
 * per-commit, and lives inline in the `decisions` table.
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
    artifact: text('artifact').notNull(), // 'claims' | 'scanState' | 'rawClaims' | 'chains'
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
