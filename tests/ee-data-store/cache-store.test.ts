import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import {
  getCacheEntry,
  setCacheEntry,
  setKvCacheStore,
  resetKvCacheStore,
} from '@truecourse/llm';
import { PgKvCacheStore } from '../../ee/packages/data-store/src/index';

describe('FileKvCacheStore (the OSS default, via the seam delegators)', () => {
  let scope: string;
  beforeEach(() => {
    scope = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cache-'));
    resetKvCacheStore();
  });
  afterEach(() => {
    resetKvCacheStore();
    fs.rmSync(scope, { recursive: true, force: true });
  });

  it('writes/reads at <scope>/.truecourse/.cache/<name>/<key>.json (unchanged OSS layout)', async () => {
    expect(await getCacheEntry(scope, 'extractor/slices', 'abc')).toBeNull();
    await setCacheEntry(scope, 'extractor/slices', 'abc', { hello: 'world' });
    const file = path.join(scope, '.truecourse', '.cache', 'extractor', 'slices', 'abc.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(await getCacheEntry(scope, 'extractor/slices', 'abc')).toEqual({ hello: 'world' });
    // a different scope is isolated for the file impl
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cache2-'));
    expect(await getCacheEntry(other, 'extractor/slices', 'abc')).toBeNull();
    fs.rmSync(other, { recursive: true, force: true });
  });
});

describe('PgKvCacheStore (pglite) — global, content-addressed', () => {
  let client: PGlite;
  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setKvCacheStore(new PgKvCacheStore(db as unknown as EeDb));
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
