import { pgTable, text, bigint, jsonb, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';

/** Dashboard activity is repository scoped, like the corpus and guard stores. */
export const activityRuns = pgTable('activity_runs', {
  runId: text('run_id').primaryKey(),
  repoKey: text('repo_key').notNull(),
  command: text('command').notNull(),
  record: jsonb('record').$type<Record<string, unknown>>().notNull(),
  nextCursor: bigint('next_cursor', { mode: 'number' }).notNull().default(0),
  owner: text('owner'),
  leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'string' }),
}, t => [index('activity_runs_repo_idx').on(t.repoKey)]);

/** Run updates and complete transcript events share a single ordered journal. */
export const activityEvents = pgTable('activity_events', {
  runId: text('run_id').notNull().references(() => activityRuns.runId, { onDelete: 'cascade' }),
  cursor: bigint('cursor', { mode: 'number' }).notNull(),
  body: jsonb('body').$type<Record<string, unknown>>().notNull(),
}, t => [primaryKey({ columns: [t.runId, t.cursor] })]);
