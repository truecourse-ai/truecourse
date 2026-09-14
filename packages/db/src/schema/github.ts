/**
 * The pull request gate's tables. `gh_baselines` is just the pointer to the
 * repo's baseline commit — the baseline run's results live per-commit in
 * `guard_runs[repo_key, commit_sha]`, not duplicated here. The repositories
 * these rows are about live in `repositories` (see ./repositories.ts).
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const ghBaselines = pgTable('gh_baselines', {
  repoFullName: text('repo_full_name').primaryKey(),
  commitSha: text('commit_sha').notNull(),
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

// Open/closed/merged state per PR, tracked from every pull_request webhook so
// the dashboard feed can filter (GitHub-style Open default + Closed toggle).
// `state` is loosely typed text here (@truecourse/db is a leaf); the gate store casts it
// to 'open' | 'closed' | 'merged' at the boundary.
export const ghPrs = pgTable(
  'gh_prs',
  {
    repoFullName: text('repo_full_name').notNull(),
    prNumber: integer('pr_number').notNull(),
    title: text('title'),
    state: text('state').notNull(),
    headSha: text('head_sha').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoFullName, t.prNumber] })],
);
