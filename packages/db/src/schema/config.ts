/**
 * Per-repo config + UI state, and the global project registry, for the hosted
 * edition. These replace the file-based `config.json`, `ui-state.json`, and the
 * global `~/.truecourse/registry.json`. The payloads are small and queried
 * whole, so they stay inline `jsonb` (no blob ref). `repo_key` is the opaque
 * per-repo identity (the seam's `repoDir`); the registry is keyed by `slug` and
 * holds the same `RegistryEntry` shape the file impl persisted.
 */

import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const repoConfig = pgTable('repo_config', {
  repoKey: text('repo_key').primaryKey(),
  config: jsonb('config').$type<unknown>().notNull(),
});

export const repoUiState = pgTable('repo_ui_state', {
  repoKey: text('repo_key').primaryKey(),
  state: jsonb('state').$type<unknown>().notNull(),
});

export const registry = pgTable('registry', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  /** Repo identity (a filesystem path for the file impl; opaque for hosted). Unique. */
  path: text('path').notNull().unique(),
  // Stored as text (not timestamptz) so the exact ISO-8601 string round-trips,
  // matching the file impl — these are surfaced verbatim in RegistryEntry.
  lastOpened: text('last_opened'),
  lastAnalyzed: text('last_analyzed'),
  /** Insertion order, so the registry lists projects oldest-first like the file impl. */
  createdAt: ts('created_at').notNull().defaultNow(),
});
