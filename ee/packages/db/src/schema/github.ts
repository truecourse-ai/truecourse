/**
 * GitHub App gate tables. `gh_baselines` is just the pointer to the repo's
 * baseline commit — its drifts live in `verify_snapshots[repo_key, commit_sha]`
 * (the single per-commit snapshot home), not duplicated here.
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
  primaryKey,
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
  // Code Quality (analyze) gate: whether new violations at/above the min severity
  // fail a required Check (default block on `high`+). Separate from `blocking`
  // (drift). `min severity` is loosely typed text here (ee-db is a leaf).
  codeQualityBlocking: boolean('code_quality_blocking').notNull().default(true),
  codeQualityMinSeverity: text('code_quality_min_severity').notNull().default('high'),
  enabled: boolean('enabled').notNull().default(true),
  notifyEmails: text('notify_emails')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // Per-type email toggles ({ gateFailure, inferResult, conflicts }). Loosely typed here
  // (ee-db is a dependency-free leaf); the gate store casts at the boundary.
  // Null = unset → every type on.
  notifications: jsonb('notifications').$type<Record<string, boolean>>(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const ghBaselines = pgTable('gh_baselines', {
  repoFullName: text('repo_full_name').primaryKey(),
  commitSha: text('commit_sha').notNull(),
  capturedAt: ts('captured_at').notNull(),
});

// Persistent per-repo overlay of user actions on inferred decisions. Applied by
// the baseline AFTER inference, so a dismiss/promote survives a re-baseline (which
// re-infers from scratch). One row per decision, keyed by (repo, kind, identity).
export const ghInferredActions = pgTable(
  'gh_inferred_actions',
  {
    repoFullName: text('repo_full_name').notNull(),
    kind: text('kind').notNull(),
    identity: text('identity').notNull(),
    // 'dismissed' | 'promoted' — loosely typed (ee-db is a leaf).
    status: text('status').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoFullName, t.kind, t.identity] })],
);

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
