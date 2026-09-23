/**
 * ENTITLEMENTS: which enterprise features a workspace may use.
 *
 * One row per (workspace_org_id, feature), and the row exists exactly while the
 * grant does — a revoke deletes it. Per feature rather than one enterprise
 * flag, because the three are independent: a workspace that paid for the
 * document connections has not thereby asked for more than one workspace.
 *
 * The deployment still has to CARRY the feature: a grant on a server booted
 * without the enterprise bundle beside it names something that is not there.
 */

import { pgTable, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const workspaceEntitlements = pgTable(
  'workspace_entitlements',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** One of `@truecourse/shared`'s `ENTERPRISE_FEATURES`. */
    feature: text('feature').notNull(),
    grantedAt: ts('granted_at').notNull(),
    /** The operator who granted it. */
    grantedBy: text('granted_by'),
    note: text('note'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.feature] }),
    index('workspace_entitlements_org_idx').on(t.workspaceOrgId),
  ],
);
