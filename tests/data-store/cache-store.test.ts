import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import {
  getCacheEntry,
  setCacheEntry,
  setKvCacheStore,
  resetKvCacheStore,
} from '@truecourse/llm';
import { PgKvCacheStore } from '../../packages/data-store/src/index';

describe('the KV cache with nothing installed (the seam default)', () => {
  beforeEach(() => resetKvCacheStore());
  afterEach(() => resetKvCacheStore());

  // A cache is an optimization: a process that never installed one must still
  // run — every read misses and every write is dropped, never throws.
  it('misses every read and drops every write', async () => {
    expect(await getCacheEntry('/clone/a', 'extractor/slices', 'abc')).toBeNull();
    await expect(
      setCacheEntry('/clone/a', 'extractor/slices', 'abc', { hello: 'world' }),
    ).resolves.toBeUndefined();
    expect(await getCacheEntry('/clone/a', 'extractor/slices', 'abc')).toBeNull();
  });
});

describe('PgKvCacheStore (pglite) — global, content-addressed', () => {
  let client: PGlite;
  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setKvCacheStore(new PgKvCacheStore(db as unknown as Db));
  });
  afterEach(async () => {
    resetKvCacheStore();
    await client.close();
  });

  it('round-trips + upserts, keyed by (name, key) and ignoring scope', async () => {
    expect(await getCacheEntry('/clone/a', 'consolidator/blocks', 'b1')).toBeNull();
    await setCacheEntry('/clone/a', 'consolidator/blocks', 'b1', { claims: [1] });
    expect(await getCacheEntry('/clone/a', 'consolidator/blocks', 'b1')).toEqual({ claims: [1] });

    // GLOBAL: a different scope (e.g. a fresh clone path) hits the same entry.
    expect(await getCacheEntry('/clone/DIFFERENT', 'consolidator/blocks', 'b1')).toEqual({ claims: [1] });

    // upsert overwrites
    await setCacheEntry('/clone/a', 'consolidator/blocks', 'b1', { claims: [2] });
    expect(await getCacheEntry('/x', 'consolidator/blocks', 'b1')).toEqual({ claims: [2] });

    // namespaced by cache name
    expect(await getCacheEntry('/x', 'extractor/slices', 'b1')).toBeNull();
  });
});
