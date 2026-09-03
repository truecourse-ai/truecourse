/**
 * The mutable resolution ledger — one current row per scope (a repo_key, or a
 * workspace org). Decisions are per-scope and always-latest (edited one at a time
 * as conflicts are resolved), NOT per-commit — so they live here, inline, rather
 * than in the per-commit content-addressed `spec_sets` manifest.
 */

import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const decisions = pgTable('decisions', {
  scope: text('scope').primaryKey(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  updatedAt: ts('updated_at').notNull(),
});
