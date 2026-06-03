import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import {
  FsBlobStore,
  PostgresBlobStore,
  selectBlobStore,
  loadBlobStoreConfig,
} from '../../ee/packages/storage/src/index';

describe('FsBlobStore', () => {
  let dir: string;
  let store: FsBlobStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-blob-'));
    store = new FsBlobStore(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips put/get/exists with nested keys', async () => {
    await store.put('ws/repo/contracts/abc', Buffer.from('hello'));
    expect((await store.get('ws/repo/contracts/abc'))?.toString()).toBe('hello');
    expect(await store.exists('ws/repo/contracts/abc')).toBe(true);
  });

  it('get null + exists false for a missing key', async () => {
    expect(await store.get('nope')).toBeNull();
    expect(await store.exists('nope')).toBe(false);
  });

  it('delete is idempotent', async () => {
    await store.put('k', Buffer.from('x'));
    await store.delete('k');
    expect(await store.get('k')).toBeNull();
    await expect(store.delete('k')).resolves.toBeUndefined();
  });

  it('contains path-traversal keys within the root', async () => {
    await store.put('../escape', Buffer.from('x'));
    expect(fs.existsSync(path.join(dir, 'escape'))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(dir), 'escape'))).toBe(false);
  });
});

describe('PostgresBlobStore (pglite)', () => {
  let client: PGlite;
  let store: PostgresBlobStore;
  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    store = new PostgresBlobStore(db as unknown as EeDb);
  });
  afterEach(async () => {
    await client.close();
  });

  it('round-trips bytea and overwrites on re-put', async () => {
    await store.put('k1', Buffer.from('first'), { contentType: 'text/plain' });
    expect((await store.get('k1'))?.toString()).toBe('first');
    expect(await store.exists('k1')).toBe(true);
    await store.put('k1', Buffer.from('second'));
    expect((await store.get('k1'))?.toString()).toBe('second');
  });

  it('get null + exists false for missing; delete idempotent', async () => {
    expect(await store.get('missing')).toBeNull();
    expect(await store.exists('missing')).toBe(false);
    await store.put('d', Buffer.from('x'));
    await store.delete('d');
    expect(await store.get('d')).toBeNull();
    await expect(store.delete('d')).resolves.toBeUndefined();
  });

  it('preserves binary (non-utf8) bytes intact', async () => {
    const bin = Buffer.from([0, 1, 2, 255, 254, 128]);
    await store.put('bin', bin);
    expect(await store.get('bin')).toEqual(bin);
  });
});

describe('selectBlobStore / loadBlobStoreConfig', () => {
  it('builds fs + s3 + azure adapters; postgres needs a db', () => {
    expect(selectBlobStore({ kind: 'fs', root: '/tmp/x' })).toBeInstanceOf(FsBlobStore);
    expect(() =>
      selectBlobStore({ kind: 's3', bucket: 'b', endpoint: 'http://localhost:9000' }),
    ).not.toThrow();
    expect(() => selectBlobStore({ kind: 'azure', account: 'acct', container: 'c' })).not.toThrow();
    expect(() => selectBlobStore({ kind: 'postgres' })).toThrow(/requires/i);
  });

  it('defaults to postgres when BLOB_STORE is unset', () => {
    const prev = process.env.BLOB_STORE;
    delete process.env.BLOB_STORE;
    expect(loadBlobStoreConfig().kind).toBe('postgres');
    if (prev !== undefined) process.env.BLOB_STORE = prev;
  });

  it('reads s3 + azure config from env', () => {
    const prev = { ...process.env };
    process.env.BLOB_STORE = 's3';
    process.env.S3_BUCKET = 'my-bucket';
    process.env.S3_ENDPOINT = 'http://minio:9000';
    const s3 = loadBlobStoreConfig();
    expect(s3).toMatchObject({ kind: 's3', bucket: 'my-bucket', endpoint: 'http://minio:9000' });
    process.env.BLOB_STORE = 'azure';
    process.env.AZURE_STORAGE_ACCOUNT = 'acct';
    process.env.AZURE_STORAGE_CONTAINER = 'cont';
    expect(loadBlobStoreConfig()).toMatchObject({ kind: 'azure', account: 'acct', container: 'cont' });
    process.env = prev;
  });
});
