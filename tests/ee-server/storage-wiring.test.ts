import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type DbHandle } from '@truecourse/db';
import { installEeStores, sweepStaleTempDirs } from '../../ee/packages/server/src/storage';
import { getSpecStore, resetSpecStore } from '@truecourse/core/lib/spec-store';
import { getGuardStore, resetGuardStore } from '@truecourse/core/lib/guard-store';
import { getRegistryStore, resetRegistryStore } from '@truecourse/core/config/registry';
import { getKvCacheStore, resetKvCacheStore } from '@truecourse/llm';
import {
  PgSpecStore,
  PgGuardStore,
  GhReposRegistryStore,
  PgKvCacheStore,
} from '@truecourse/ee-data-store';

// `installEeStores` reads only `db`; the lock pool is part of the handle shape.
const stubLockPool = {
  connect: async () => ({ query: async () => ({}), release: () => {} }),
} as unknown as DbHandle['lockPool'];

function resetAll() {
  resetSpecStore();
  resetGuardStore();
  resetRegistryStore();
  resetKvCacheStore();
}

describe('installEeStores — swaps every seam to its Postgres impl', () => {
  let client: PGlite;
  let prevBlob: string | undefined;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    prevBlob = process.env.BLOB_STORE;
    process.env.BLOB_STORE = 'postgres'; // use the shared db, no real cloud
    installEeStores({ db, lockPool: stubLockPool, close: async () => {} } as unknown as DbHandle);
  });
  afterEach(async () => {
    resetAll();
    if (prevBlob === undefined) delete process.env.BLOB_STORE;
    else process.env.BLOB_STORE = prevBlob;
    await client.close();
  });

  it('installs every hosted store', () => {
    expect(getSpecStore()).toBeInstanceOf(PgSpecStore);
    expect(getGuardStore()).toBeInstanceOf(PgGuardStore);
    expect(getRegistryStore()).toBeInstanceOf(GhReposRegistryStore);
    expect(getKvCacheStore()).toBeInstanceOf(PgKvCacheStore);
  });

  it('the installed stores actually round-trip through Postgres', async () => {
    // A write+read through the (now hosted) spec seam lands in the DB, not a file.
    const ref = { repoKey: 'acme/api', commitSha: 'sha1' };
    await getSpecStore().saveSpec(ref, 'corpus', { version: 3 });
    expect(await getSpecStore().loadSpec(ref, 'corpus')).toEqual({ version: 3 });
    // No `.truecourse/` dir was created for the (non-filesystem) repo key.
    expect(fs.existsSync(path.join('acme/api', '.truecourse'))).toBe(false);
  });

  // There is no default to fall back to: a seam with nothing installed fails
  // loud rather than inventing an empty store.
  it('resetAll leaves every seam uninstalled', () => {
    resetAll();
    expect(() => getSpecStore()).toThrow(/No spec store installed/);
    expect(() => getGuardStore()).toThrow(/No guard store installed/);
    expect(() => getRegistryStore()).toThrow(/No repository registry installed/);
  });
});

describe('sweepStaleTempDirs', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-root-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reaps stale tc-* temp dirs and keeps fresh ones', () => {
    const now = Date.now();
    const mk = (name: string) => {
      const d = path.join(root, name);
      fs.mkdirSync(d);
      return d;
    };
    const stale = mk('tc-gate-stale-xyz');
    const fresh = mk('tc-gate-fresh-abc');
    const unrelated = mk('other-tool-123');

    // Age the stale dir past the 1h window.
    const old = (now - 2 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(stale, old, old);

    const removed = sweepStaleTempDirs(now, root);
    expect(removed).toBe(1);
    expect(fs.existsSync(stale)).toBe(false); // stale tc-* → reaped
    expect(fs.existsSync(fresh)).toBe(true); // fresh tc-* → kept
    expect(fs.existsSync(unrelated)).toBe(true); // non-tc → never touched
  });
});
