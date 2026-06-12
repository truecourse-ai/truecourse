/**
 * Workspace-scoped Knowledge for the hosted edition. Specs/contracts generated
 * from connected tools (or manual upload) are shared by every repo in the
 * workspace, so they are keyed by the WorkOS organization id (`workspace_org_id`,
 * the same convention as `gh_repos`/`gh_installations`) rather than `repo_key`.
 *
 * Workspace Knowledge is **always-latest**: one current row per
 * `(workspace_org_id, artifact)` with NO commit dimension — unlike the per-commit
 * repo `spec_sets`. A parallel table (rather than nullable columns on `spec_sets`)
 * keeps the repo PK and migration history untouched.
 *
 * `knowledge_documents` is a thin per-document provenance ledger: one row per
 * source doc the Knowledge was built from. We NEVER store the body — only its
 * identity + content hash (for incremental-sync diffing and UI click-through).
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

export const workspaceSpecSets = pgTable(
  'workspace_spec_sets',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    artifact: text('artifact').notNull(), // 'claims' | 'scanState'
    /** sha into `content` (scope = org) — the immutable artifact body. */
    contentSha: text('content_sha').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceOrgId, t.artifact] })],
);

/**
 * Workspace contracts: the `.tc` corpus generated from the workspace's canonical
 * claims, shared by every repo. Like the repo `contract_sets`, only the per-set
 * MANIFEST (`{relPath: sha}`) lives here; the `.tc` bodies are content-addressed
 * blobs in the `BlobStore`. Always-latest — one current set per `(org, kind)`,
 * no commit dimension (mirrors `workspace_spec_sets`).
 */
export const workspaceContractSets = pgTable(
  'workspace_contract_sets',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    kind: text('kind').notNull(), // 'contracts' | 'contracts_inferred'
    /** `{ v: 1, files: { relPath: 'sha256-…' } }` — the set's content manifest. */
    manifest: jsonb('manifest').$type<unknown>().notNull(),
    /** sha256 over the canonical (sorted) manifest — stable set identity / GC mark. */
    manifestHash: text('manifest_hash').notNull(),
    fileCount: integer('file_count').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceOrgId, t.kind] })],
);

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** 'manual' (Phase 1) | 'confluence' | 'jira' | … (connector kind). */
    sourceKind: text('source_kind').notNull(),
    /** Tool doc id (connector) or a generated id (manual) — stable per source doc. */
    externalId: text('external_id').notNull(),
    /** Stable relative path fed into the slicer's blockId hash / claim provenance. */
    docPath: text('doc_path').notNull(),
    title: text('title').notNull(),
    /** Deep link to the source (connector); null for manual docs. */
    url: text('url'),
    /** Source version string (connector); null when only a content hash is available. */
    version: text('version'),
    /** sha256 of the body at last sync — the incremental-sync diff key. */
    contentHash: text('content_hash').notNull(),
    lastSyncedAt: ts('last_synced_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.sourceKind, t.externalId] }),
    index('knowledge_documents_org_idx').on(t.workspaceOrgId),
  ],
);
