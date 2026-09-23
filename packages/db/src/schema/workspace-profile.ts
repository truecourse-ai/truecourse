/**
 * The workspace's own row — what it says its product is.
 *
 * A TABLE OF ITS OWN rather than a column beside the Context staleness stamp:
 * `context_workspaces` is Context's bookkeeping (a `changed_at` that is not
 * null and means "the corpus is behind"), written by syncs and links, and a
 * workspace that has described itself and synced nothing has no honest value
 * for it. The description is the workspace's, not Context's, and it is the
 * first row of what a workspace holds of its own — its name and its people are
 * the identity provider's.
 */

import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const workspaceProfiles = pgTable('workspace_profiles', {
  workspaceOrgId: text('workspace_org_id').primaryKey(),
  /** What the product is, in one sentence. The Document scan attributes against it. */
  description: text('description').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});
