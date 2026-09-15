/**
 * The mutable resolution ledger — one current row per scope: a workspace org
 * (`ws:<org>`, the curation decisions) or a repository's guard decisions
 * (`guard:<owner/repo>`). Always-latest, edited one at a time as conflicts are
 * resolved, so the payload lives here inline rather than content-addressed.
 */

import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const decisions = pgTable('decisions', {
  scope: text('scope').primaryKey(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  updatedAt: ts('updated_at').notNull(),
});
