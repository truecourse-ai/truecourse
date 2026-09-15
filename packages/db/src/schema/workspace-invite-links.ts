/**
 * Invite links: a workspace's standing invitations that name no email.
 *
 * A WorkOS invitation is bound to an address; a link is bound to nothing but
 * its token, so whoever holds it signs up with any email and joins the
 * organization (`workspace_org_id`, the WorkOS organization id) when the
 * server redeems it. One row per link. `consumed_at` is set exactly once, by
 * the redemption that won, which is what makes a link single-use; a revoked
 * link is simply deleted.
 */

import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const workspaceInviteLinks = pgTable(
  'workspace_invite_links',
  {
    id: text('id').primaryKey(),
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** The secret the link carries; the only thing a visitor presents. */
    token: text('token').notNull().unique(),
    inviterUserId: text('inviter_user_id').notNull(),
    /** The sender's name as it was when the link was minted: what the invite page shows. */
    inviterName: text('inviter_name'),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    consumedByUserId: text('consumed_by_user_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('workspace_invite_links_org_idx').on(t.workspaceOrgId)],
);
