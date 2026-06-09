import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDbHandle } from '@truecourse/ee-db';
import { installEeStores, sweepStaleTempDirs } from '../../ee/packages/server/src/storage';
import { getAnalysisStore, resetAnalysisStore } from '@truecourse/core/lib/analysis-store';
import { getVerifyStore, resetVerifyStore } from '@truecourse/core/lib/verify-store';
import { getContractStore, resetContractStore } from '@truecourse/core/lib/contract-store';
import { getSpecStore, resetSpecStore } from '@truecourse/core/lib/spec-store';
import { getRepoConfigStore, resetRepoConfigStore } from '@truecourse/core/config/project-config';
import { getUiStateStore, resetUiStateStore } from '@truecourse/core/config/ui-state';
import { getRegistryStore, resetRegistryStore } from '@truecourse/core/config/registry';
import { getAnalyzeLock, resetAnalyzeLock } from '@truecourse/core/lib/analyze-lock';
import { getKvCacheStore, resetKvCacheStore } from '@truecourse/llm';
import {
  PgBlobAnalysisStore,
  PgBlobVerifyStore,
  PgBlobContractStore,
  PgSpecStore,
  PgRepoConfigStore,
  PgUiStateStore,
  GhReposRegistryStore,
  PgKvCacheStore,
  PgAnalyzeLock,
} from '@truecourse/ee-data-store';

// The analyze lock needs a session (a `pg.Pool`); PGlite isn't one. The wiring
// test only asserts the seam was swapped (instanceof), so a no-op pool suffices.
const stubLockPool = {
  connect: async () => ({ query: async () => ({}), release: () => {} }),
} as unknown as EeDbHandle['lockPool'];

function resetAll() {
  resetAnalysisStore();
  resetVerifyStore();
  resetContractStore();
  resetSpecStore();
  resetRepoConfigStore();
  resetUiStateStore();
  resetRegistryStore();
  resetKvCacheStore();
  resetAnalyzeLock();
}

describe('installEeStores — swaps every seam to its Postgres/Blob impl', () => {
  let client: PGlite;
  let prevBlob: string | undefined;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    prevBlob = process.env.BLOB_STORE;
    process.env.BLOB_STORE = 'postgres'; // use the shared db, no real cloud
    installEeStores({ db, lockPool: stubLockPool, close: async () => {} } as unknown as EeDbHandle);
  });
  afterEach(async () => {
    resetAll();
    if (prevBlob === undefined) delete process.env.BLOB_STORE;
    else process.env.BLOB_STORE = prevBlob;
    await client.close();
  });

  it('installs every hosted store + the advisory-lock seam', () => {
    expect(getAnalysisStore()).toBeInstanceOf(PgBlobAnalysisStore);
    expect(getVerifyStore()).toBeInstanceOf(PgBlobVerifyStore);
    expect(getContractStore()).toBeInstanceOf(PgBlobContractStore);
    expect(getSpecStore()).toBeInstanceOf(PgSpecStore);
    expect(getRepoConfigStore()).toBeInstanceOf(PgRepoConfigStore);
    expect(getUiStateStore()).toBeInstanceOf(PgUiStateStore);
    expect(getRegistryStore()).toBeInstanceOf(GhReposRegistryStore);
    expect(getKvCacheStore()).toBeInstanceOf(PgKvCacheStore);
    expect(getAnalyzeLock()).toBeInstanceOf(PgAnalyzeLock);
  });

  it('the installed stores actually round-trip through Postgres', async () => {
    // A write+read through the (now hosted) config seam lands in the DB, not a file.
    await getRepoConfigStore().writeProjectConfig('acme/api', { enableLlmRules: false });
    expect(await getRepoConfigStore().readProjectConfig('acme/api')).toEqual({ enableLlmRules: false });
    // No `.truecourse/` dir was created for the (non-filesystem) repo key.
    expect(fs.existsSync(path.join('acme/api', '.truecourse'))).toBe(false);
  });

  it('resetAll restores the OSS file-backed defaults', () => {
    resetAll();
    expect(getAnalysisStore()).not.toBeInstanceOf(PgBlobAnalysisStore);
    expect(getKvCacheStore()).not.toBeInstanceOf(PgKvCacheStore);
    expect(getAnalyzeLock()).not.toBeInstanceOf(PgAnalyzeLock);
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
    const fresh = mk('tc-contracts-fresh-abc');
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
