/**
 * GitHub App gate tables. `drifts` is loosely typed (`unknown[]`) at this layer
 * so `ee-db` stays a dependency-free leaf; the gate store casts to its
 * `GateDrift[]` domain type at the boundary.
 */

import {
  pgTable,
  bigint,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const ghInstallations = pgTable('gh_installations', {
  installationId: bigint('installation_id', { mode: 'number' }).primaryKey(),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  workspaceOrgId: text('workspace_org_id'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const ghRepos = pgTable('gh_repos', {
  repoFullName: text('repo_full_name').primaryKey(),
  installationId: bigint('installation_id', { mode: 'number' }).notNull(),
  workspaceOrgId: text('workspace_org_id').notNull(),
  defaultBranch: text('default_branch').notNull(),
  blocking: boolean('blocking').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
  notifyEmails: text('notify_emails')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const ghBaselines = pgTable('gh_baselines', {
  repoFullName: text('repo_full_name').primaryKey(),
  commitSha: text('commit_sha').notNull(),
  drifts: jsonb('drifts').$type<unknown[]>(),
  capturedAt: ts('captured_at').notNull(),
});

export const ghRuns = pgTable(
  'gh_runs',
  {
    id: text('id').primaryKey(),
    repoFullName: text('repo_full_name').notNull(),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    baseSha: text('base_sha'),
    conclusion: text('conclusion').notNull(),
    addedCount: integer('added_count').notNull(),
    resolvedCount: integer('resolved_count').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('gh_runs_repo_created_idx').on(t.repoFullName, t.createdAt)],
);
