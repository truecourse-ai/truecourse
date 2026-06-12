import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgContractStore } from '@truecourse/ee-data-store';
import {
  listContractFiles,
  readContractFile,
  saveContracts,
  setContractStore,
  resetContractStore,
} from '@truecourse/core/lib/contract-store';

const REPO_KEY = 'acme/api';

function seed(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
}

describe('contract browse (listContractFiles / readContractFile) — file impl', () => {
  let repo: string;
  beforeEach(() => {
    resetContractStore();
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browse-'));
    seed(path.join(repo, '.truecourse', 'contracts'), {
      '_shared/auth.tc': 'auth',
      'order/operations/get-order.tc': 'GET /orders',
      '_inferred/order/inferred-x.tc': 'inferred',
    });
  });
  afterEach(() => {
    resetContractStore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('lists authored (excluding _inferred) for kind contracts; _inferred separately', async () => {
    expect((await listContractFiles(repo, 'contracts')).sort()).toEqual([
      '_shared/auth.tc',
      'order/operations/get-order.tc',
    ]);
    expect(await listContractFiles(repo, 'contracts_inferred')).toEqual(['order/inferred-x.tc']);
  });

  it('reads a file and rejects traversal/unknown paths', async () => {
    expect(await readContractFile(repo, 'contracts', 'order/operations/get-order.tc')).toBe('GET /orders');
    expect(await readContractFile(repo, 'contracts', 'nope.tc')).toBeNull();
    expect(await readContractFile(repo, 'contracts', '../../../etc/passwd')).toBeNull();
    expect(await readContractFile(repo, 'contracts_inferred', 'order/inferred-x.tc')).toBe('inferred');
  });
});

describe('contract browse — EE impl (latest stored set, content-addressed)', () => {
  let client: PGlite;
  let blobDir: string;
  let srcDir: string;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browse-blob-'));
    setContractStore(new PgContractStore(db as unknown as EeDb, new FsBlobStore(blobDir)));
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browse-src-'));
  });
  afterEach(async () => {
    resetContractStore();
    await client.close();
    fs.rmSync(blobDir, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  it('browses the LATEST stored set and reads file content from the blob', async () => {
    // c1 then c2 (c2 changes one file + adds one) — browse must reflect c2.
    seed(srcDir, { '_shared/auth.tc': 'auth', 'order/get.tc': 'v1' });
    await saveContracts({ repoKey: REPO_KEY, commitSha: 'c1' }, 'contracts', srcDir);

    const src2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browse-src2-'));
    seed(src2, { '_shared/auth.tc': 'auth', 'order/get.tc': 'v2', 'order/list.tc': 'list' });
    await saveContracts({ repoKey: REPO_KEY, commitSha: 'c2' }, 'contracts', src2);

    expect((await listContractFiles(REPO_KEY, 'contracts')).sort()).toEqual([
      '_shared/auth.tc',
      'order/get.tc',
      'order/list.tc',
    ]);
    expect(await readContractFile(REPO_KEY, 'contracts', 'order/get.tc')).toBe('v2'); // latest
    expect(await readContractFile(REPO_KEY, 'contracts', 'order/list.tc')).toBe('list');
    expect(await readContractFile(REPO_KEY, 'contracts', 'unknown.tc')).toBeNull();
    // an unknown repo browses to nothing
    expect(await listContractFiles('other/repo', 'contracts')).toEqual([]);
    fs.rmSync(src2, { recursive: true, force: true });
  });

  it('browses a SPECIFIC commit when given a commitSha (the ref switcher)', async () => {
    seed(srcDir, { '_shared/auth.tc': 'auth', 'order/get.tc': 'v1' });
    await saveContracts({ repoKey: REPO_KEY, commitSha: 'c1' }, 'contracts', srcDir);

    const src2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browse-src2-'));
    seed(src2, { '_shared/auth.tc': 'auth', 'order/get.tc': 'v2', 'order/list.tc': 'list' });
    await saveContracts({ repoKey: REPO_KEY, commitSha: 'c2' }, 'contracts', src2);

    // Pin to c1 → the OLD set (no order/list.tc; get.tc is v1), not the latest.
    expect((await listContractFiles(REPO_KEY, 'contracts', 'c1')).sort()).toEqual([
      '_shared/auth.tc',
      'order/get.tc',
    ]);
    expect(await readContractFile(REPO_KEY, 'contracts', 'order/get.tc', 'c1')).toBe('v1');
    expect(await readContractFile(REPO_KEY, 'contracts', 'order/list.tc', 'c1')).toBeNull(); // not in c1
    // c2 explicitly → the newer set.
    expect(await readContractFile(REPO_KEY, 'contracts', 'order/get.tc', 'c2')).toBe('v2');
    // an unknown commit → nothing.
    expect(await listContractFiles(REPO_KEY, 'contracts', 'nope')).toEqual([]);
    fs.rmSync(src2, { recursive: true, force: true });
  });
});
