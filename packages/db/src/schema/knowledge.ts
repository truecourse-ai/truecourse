/**
 * Workspace-scoped Knowledge for the hosted edition. Specs generated from
 * connected tools (or manual upload) are shared by every repo in the
 * workspace, so they are keyed by the WorkOS organization id (`workspace_org_id`,
 * the same convention as `gh_repos`/`gh_installations`) rather than `repo_key`.
 *
 * Workspace Knowledge is **always-latest**: one current row per
 * `(workspace_org_id, artifact)` with NO commit dimension — unlike the per-commit
 * repo `spec_sets`. A parallel table (rather than nullable columns on `spec_sets`)
 * keeps the repo PK and migration history untouched.
 *
 * `knowledge_documents` is a thin per-document provenance ledger: one row per
 * source doc the Knowledge was built from — identity + content hash (for
 * incremental-sync diffing and UI click-through). The body itself is stored
 * separately, content-addressed in the shared `content` table under a per-org
 * knowledge scope keyed by that same `contentHash`; the ledger row is the pointer.
 */

import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const workspaceSpecSets = pgTable(
  'workspace_spec_sets',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    artifact: text('artifact').notNull(), // 'corpus' | 'decisions'
    /** sha into `content` (scope = org) — the immutable artifact body. */
    contentSha: text('content_sha').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceOrgId, t.artifact] })],
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
    /**
     * sha256 of the body the LAST process (consolidation) actually saw; null until
     * the doc is first processed. The sweep delta compares this against the fetched
     * `contentHash` — a doc synced but never processed (null), or whose content has
     * changed since it was consolidated, is pending work. Sync never touches this;
     * only the processing job stamps it (`markProcessed`).
     */
    processedHash: text('processed_hash'),
    lastSyncedAt: ts('last_synced_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.sourceKind, t.externalId] }),
    index('knowledge_documents_org_idx').on(t.workspaceOrgId),
  ],
);
