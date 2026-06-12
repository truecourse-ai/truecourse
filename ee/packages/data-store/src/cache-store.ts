/**
 * Postgres implementation of `@truecourse/llm`'s `KvCacheStore` — the LLM-stage
 * extraction cache. Content-addressed and keyed globally by `(cache_name,
 * cache_key)` in `extraction_cache` (the `scope`/repo root is ignored): a slice
 * or block unchanged across runs/commits/repos hits the cache and skips the LLM.
 * This is what keeps re-generation cheap now that contracts aren't committed.
 */

import { and, eq } from 'drizzle-orm';
import { extractionCache, type EeDb } from '@truecourse/ee-db';
import type { KvCacheStore } from '@truecourse/llm';

export class PgKvCacheStore implements KvCacheStore {
  constructor(private readonly db: EeDb) {}

  async get(_scope: string, cacheName: string, key: string): Promise<unknown | null> {
    const rows = await this.db
      .select({ value: extractionCache.value })
      .from(extractionCache)
      .where(and(eq(extractionCache.cacheName, cacheName), eq(extractionCache.cacheKey, key)))
      .limit(1);
    return rows[0] ? rows[0].value : null;
  }

  async set(_scope: string, cacheName: string, key: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(extractionCache)
      .values({ cacheName, cacheKey: key, value, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [extractionCache.cacheName, extractionCache.cacheKey],
        set: { value, updatedAt: now },
      });
  }
}
