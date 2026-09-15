/**
 * Repositories and the provider accounts they come through.
 *
 * A repository reaches TrueCourse through a PROVIDER: the GitHub App, or the
 * local machine. `provider_accounts` is what a provider that has accounts
 * records — a GitHub App installation is one — and a provider with none (a
 * folder on this machine) writes no row here at all, which is why a
 * repository's account is nullable.
 */

import { pgTable, text, boolean, timestamp, jsonb, index, primaryKey, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const providerAccounts = pgTable(
  'provider_accounts',
  {
    /** 'github' today; the seam is the column. */
    provider: text('provider').notNull(),
    /** The provider's own id for the account (GitHub: the installation id). */
    accountId: text('account_id').notNull(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    workspaceOrgId: text('workspace_org_id'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.accountId] }),
    index('provider_accounts_workspace_idx').on(t.workspaceOrgId),
  ],
);

export const repositories = pgTable(
  'repositories',
  {
    /** The repository's identity: `owner/name` for a provider, `local/<folder>` for a folder. */
    repoFullName: text('repo_full_name').primaryKey(),
    provider: text('provider').notNull(),
    /** `provider_accounts.account_id`; null for a provider with no accounts. */
    accountId: text('account_id'),
    workspaceOrgId: text('workspace_org_id').notNull(),
    /**
     * The `:id` the routes and the client address it by. Minted once, when the
     * repository is connected, from its name against the slugs its workspace
     * already holds; unique within the workspace, not across them, so two
     * workspaces connecting the same-named repository both get the plain slug.
     */
    slug: text('slug').notNull(),
    /** The branch the provider tracks; null for a local folder, which has whatever is checked out. */
    defaultBranch: text('default_branch'),
    /** Where the provider finds it, when the name is not enough: a local folder's absolute path. */
    location: text('location'),
    /**
     * `blocking`, `notify_emails` and `notifications` are unused today: nothing
     * reads them and nothing sends. They are kept for the notification design,
     * which is not built yet. `enabled` between them is live — a disabled
     * connection is one a push no longer re-baselines. `notifications` is
     * loosely typed because @truecourse/db is a dependency-free leaf; the store
     * casts at the boundary.
     */
    blocking: boolean('blocking').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    notifyEmails: text('notify_emails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notifications: jsonb('notifications').$type<Record<string, boolean>>(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('repositories_workspace_idx').on(t.workspaceOrgId),
    index('repositories_account_idx').on(t.provider, t.accountId),
    unique('repositories_workspace_slug_unique').on(t.workspaceOrgId, t.slug),
  ],
);
