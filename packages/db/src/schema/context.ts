/**
 * Context — the workspace's documentation sources, what they yielded, and which
 * repositories read them. Workspace-scoped (`workspace_org_id`, the same
 * convention as `gh_repos` / `knowledge_documents`), because a source belongs
 * to the workspace and a repository only BINDS it.
 *
 *   context_sources   — one feed of documents of one kind, with its scope
 *                       (`config`) and where it stands with its origin.
 *   context_syncs     — one row per refresh: when, and the counts it reconciled.
 *   context_documents — the ledger: one row per document a source currently
 *                       yields. The BODY is not here — it is content-addressed
 *                       in `content` under scope `context:ws:<org>`, keyed
 *                       `sha256-<content_hash>`.
 *   context_bindings  — a repository reads a source.
 *   context_workspaces — ONE stamp per workspace: when its Context last changed
 *                       in a way that makes the corpus stale. Every mutation
 *                       that changes what a repository would read bumps it —
 *                       a sync that added / changed / removed anything, a link
 *                       made or dropped, a source removed. It exists because
 *                       none of those can be derived from the rows that
 *                       SURVIVE: an unlink and a removal leave nothing behind
 *                       to carry their own timestamp.
 *
 * Removing a source removes its documents, its syncs and every binding; the
 * bodies it was the last reader of are swept with them.
 */

import { pgTable, text, integer, timestamp, primaryKey, index, jsonb } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const contextSources = pgTable(
  'context_sources',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    id: text('id').notNull(),
    /** 'repository' | 'site' — the six tool kinds are reserved values. */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** The scope: repository → repoFullName/include/exclude/branch; site → llmsTxtUrl. */
    config: jsonb('config').notNull(),
    /** 'synced' | 'syncing' | 'failed' | 'paused' | 'never'. */
    status: text('status').notNull(),
    /** The failure reason, verbatim — null unless the status needs one. */
    statusNote: text('status_note'),
    lastSyncAt: ts('last_sync_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.id] }),
    index('context_sources_org_kind_idx').on(t.workspaceOrgId, t.kind),
  ],
);

export const contextSyncs = pgTable(
  'context_syncs',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    sourceId: text('source_id').notNull(),
    at: ts('at').notNull(),
    /** The sync this one diffed against — null for the first. */
    parentAt: ts('parent_at'),
    added: integer('added').notNull(),
    changed: integer('changed').notNull(),
    removed: integer('removed').notNull(),
    unchanged: integer('unchanged').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.sourceId, t.at] }),
    index('context_syncs_org_at_idx').on(t.workspaceOrgId, t.at),
  ],
);

export const contextDocuments = pgTable(
  'context_documents',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    sourceId: text('source_id').notNull(),
    /** The page URL for a site, the repo-relative path for a repository. */
    docId: text('doc_id').notNull(),
    /** The ref's path half (`context/<sourceId>/<docPath>`). */
    docPath: text('doc_path').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    /** sha256 HEX of the body; the pool key is `sha256-<content_hash>`. */
    contentHash: text('content_hash').notNull(),
    /** When the document last CHANGED at its source. */
    updatedAt: ts('updated_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.sourceId, t.docId] }),
    index('context_documents_org_idx').on(t.workspaceOrgId),
    index('context_documents_path_idx').on(t.workspaceOrgId, t.sourceId, t.docPath),
  ],
);

export const contextBindings = pgTable(
  'context_bindings',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    repoFullName: text('repo_full_name').notNull(),
    sourceId: text('source_id').notNull(),
    /** When the link was made. */
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.repoFullName, t.sourceId] }),
    index('context_bindings_org_source_idx').on(t.workspaceOrgId, t.sourceId),
  ],
);

export const contextWorkspaces = pgTable('context_workspaces', {
  workspaceOrgId: text('workspace_org_id').primaryKey(),
  /** When this workspace's Context last changed in a way the corpus must see. */
  changedAt: ts('changed_at').notNull(),
});
