/**
 * The WORKSPACE's spec set: the corpus and the decisions the Document scan
 * produced. Documentation belongs to the workspace, not to one repository, so
 * these rows are keyed by the WorkOS organization id (`workspace_org_id`, the
 * same convention as `gh_repos`/`gh_installations`) rather than `repo_key`.
 *
 * Always-latest: one current row per `(workspace_org_id, artifact)` with NO
 * commit dimension, unlike the per-commit repo `spec_sets`.
 */

import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';

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
