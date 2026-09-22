/**
 * The WORKSPACE's spec set: the corpus the Document scan produced and the
 * snapshot of the documents it read. Documentation belongs to the workspace,
 * not to one repository, so these rows are keyed by the WorkOS organization id
 * (`workspace_org_id`, the same convention as `repositories`) rather than
 * `repo_key`.
 *
 * A SERIES per `(workspace_org_id, scope, artifact)`: every scan writes a new
 * row, and the current one is the newest of its scope. `default` is the
 * workspace's own line; a pull request's candidate corpus lives under a scope
 * of its own, with `source_commit` naming the head it read its documents at.
 * The decisions are not here: they are a ledger people edit, in `decisions`.
 */

import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const workspaceSpecSets = pgTable(
  'workspace_spec_sets',
  {
    id: text('id').primaryKey(),
    workspaceOrgId: text('workspace_org_id').notNull(),
    artifact: text('artifact').notNull(), // 'corpus' | 'docs'
    /** sha into `content` (scope = org) — the immutable artifact body. */
    contentSha: text('content_sha').notNull(),
    /** The series: `default`, or a pull request's own. */
    scope: text('scope').notNull().default('default'),
    /** The session run that produced the row, when one did. */
    producedByRun: text('produced_by_run'),
    /** The model that run was on, when one was. */
    model: text('model'),
    /** The commit a candidate read its documents at; null on the default line. */
    sourceCommit: text('source_commit'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('workspace_spec_sets_scope_idx').on(t.workspaceOrgId, t.scope, t.artifact, t.createdAt),
  ],
);
