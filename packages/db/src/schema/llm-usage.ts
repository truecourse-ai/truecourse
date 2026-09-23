/**
 * What a workspace's runs SPENT at the model.
 *
 * One row per (job, subject) — a subject being a one-shot stage or a kind of
 * agent session — so a generate's dozens of flow-worker sessions fold into one
 * row for the kind rather than one per session. The row is written
 * INCREMENTALLY while the run goes: the upsert adds this flush's tokens, calls
 * and cost onto what is there, widens the interval, and takes the newest model.
 * A run that dies, is cancelled or is still going therefore has its spend on
 * record exactly as far as it got.
 *
 * `repo_full_name` is null for the work that belongs to the workspace itself
 * (the Document scan), and `run_id` is null until the run record exists — the
 * job id is the stable identity, which is why the upsert keys on it.
 */

import { pgTable, text, timestamp, index, integer, bigint, numeric, uniqueIndex } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** USD, as a decimal so a sum of many small calls does not drift. */
const usd = (name: string) => numeric(name, { precision: 18, scale: 8 }).notNull().default('0');

/** A token counter: always a whole number, read back as a JS number. */
const tokens = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);

export const llmUsage = pgTable(
  'llm_usage',
  {
    id: text('id').primaryKey(),
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** `owner/repo`; null for the workspace's own work. */
    repoFullName: text('repo_full_name'),
    /** The job type that spent it: `context.scan`, `repo.guard-setup`, … */
    jobType: text('job_type').notNull(),
    jobId: text('job_id').notNull(),
    /** The run record this job opened, once it has one. */
    runId: text('run_id'),
    /** `stage` (a one-shot call) or `session` (an agent session's turns). */
    subjectKind: text('subject_kind').notNull(),
    /** The stage name (`guard.recipe-propose`) or the session kind (`spec-scan.curation`). */
    subject: text('subject').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: tokens('input_tokens'),
    outputTokens: tokens('output_tokens'),
    cacheReadTokens: tokens('cache_read_tokens'),
    cacheCreateTokens: tokens('cache_create_tokens'),
    calls: integer('calls').notNull().default(0),
    /** USD, as a decimal so a sum of many small calls does not drift. */
    costUsd: numeric('cost_usd', { precision: 18, scale: 8 }).notNull().default('0'),
    /** `cost_usd` by kind: fresh input and cache writes, output, cache reads. */
    inputCostUsd: usd('input_cost_usd'),
    outputCostUsd: usd('output_cost_usd'),
    cachedCostUsd: usd('cached_cost_usd'),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at').notNull(),
  },
  (t) => [
    uniqueIndex('llm_usage_subject_uniq').on(t.jobId, t.subjectKind, t.subject),
    index('llm_usage_org_started_idx').on(t.workspaceOrgId, t.startedAt),
  ],
);
