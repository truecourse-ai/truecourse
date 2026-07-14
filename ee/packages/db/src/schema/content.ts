/**
 * Content-addressed store — the single dedup pool for immutable bodies in the
 * hosted edition: contract `.tc` files, immutable spec artifacts (corpus,
 * decisions), and LLM trace payloads. One row per unique (scope, sha):
 * identical content under a scope is stored once; manifests/refs elsewhere point
 * in by `sha`. `scope` namespaces dedup + tenant isolation (a repo_key, an org,
 * or `ws:<org>`) — there is no cross-scope dedup.
 */

import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const content = pgTable(
  'content',
  {
    scope: text('scope').notNull(),
    sha: text('sha').notNull(),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.sha] })],
);
