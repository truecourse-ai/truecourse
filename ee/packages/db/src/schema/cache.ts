/**
 * LLM-stage extraction cache for the hosted edition. Replaces the file-based
 * `.truecourse/.cache/` slice/block caches so they survive ephemeral clones.
 * Keys are content hashes (slice/block id + prompt fingerprint), so the cache is
 * CONTENT-ADDRESSED and keyed globally by `(cache_name, cache_key)` — not by
 * repo. For a single-tenant self-hosted deploy that maximizes hits: identical
 * spec content across the enterprise's repos shares one entry (one LLM call),
 * and serving a hit is safe because the value is the extraction of the very
 * content the key hashes.
 */

import { pgTable, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const extractionCache = pgTable(
  'extraction_cache',
  {
    /** Cache namespace, e.g. `extractor/slices`, `consolidator/area-tags`. */
    cacheName: text('cache_name').notNull(),
    /** Content-hash key (slice/doc id). */
    cacheKey: text('cache_key').notNull(),
    /** The cached entry (incl. its own prompt fingerprint for self-invalidation). */
    value: jsonb('value').$type<unknown>().notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cacheName, t.cacheKey] })],
);
