import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, contractSets, content, type EeDb } from '@truecourse/ee-db';
import {
  PgContractStore,
  PgSpecStore,
  PgInferredActionStore,
  gcContractObjects,
  contentScope,
} from '../../ee/packages/data-store/src/index';
import type { RepoRef } from '@truecourse/core/lib/contract-store';

const REPO = 'acme/api';
const refAt = (sha: string): RepoRef => ({ repoKey: REPO, commitSha: sha });

function setup() {
  const client = new PGlite();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-src-'));
  return { client, srcDir };
}

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

/** Count the deduped contract bodies stored for a repo (content-addressed rows). */
async function objCount(db: EeDb, repoKey = REPO): Promise<number> {
  const rows = await db
    .select({ sha: content.sha })
    .from(content)
    .where(eq(content.scope, contentScope.contract(repoKey)));
  return rows.length;
}

function writeFile(root: string, rel: string, content: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

/** Authored + inferred fixture tree under `srcDir/.truecourse/contracts`. */
function seedCorpus(srcDir: string, getOrderBody = 'GET /orders'): string {
  const contracts = path.join(srcDir, '.truecourse', 'contracts');
  writeFile(contracts, '_shared/auth.tc', 'auth requirement');
  writeFile(contracts, 'order/operations/get-order.tc', getOrderBody);
  writeFile(contracts, 'order/order-model.tc', 'Order entity');
  writeFile(contracts, '_inferred/order/inferred-x.tc', 'inferred decision');
  return contracts;
}

function listFilesRel(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(childRel);
      else out.push(childRel);
    }
  };
  walk('');
  return out.sort();
}

describe('PgContractStore (pglite + Postgres content)', () => {
  let client: PGlite;
  let srcDir: string;
  let db: EeDb;
  let store: PgContractStore;

  beforeEach(async () => {
    const s = setup();
    client = s.client;
    srcDir = s.srcDir;
    db = await makeDb(client);
    store = new PgContractStore(db);
  });
  afterEach(async () => {
    await client.close();
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  it('saves authored contracts (excluding _inferred) and materializes byte-identical', async () => {
    const contracts = seedCorpus(srcDir);
    const res = await store.saveContracts(refAt('c1'), 'contracts', contracts);

    expect(Object.keys(res.manifest).sort()).toEqual([
      '_shared/auth.tc',
      'order/operations/get-order.tc',
      'order/order-model.tc',
    ]);
    expect(res.fileCount).toBe(3);
    expect(res.objectsWritten).toBe(3);
    expect(res.manifestHash).toMatch(/^sha256-/);

    expect(await store.hasContracts(refAt('c1'), 'contracts')).toBe(true);
    expect(await store.hasContracts(refAt('nope'), 'contracts')).toBe(false);

    const mat = await store.loadContracts(refAt('c1'), 'contracts');
    expect(mat).not.toBeNull();
    expect(listFilesRel(mat!.dir)).toEqual([
      '_shared/auth.tc',
      'order/operations/get-order.tc',
      'order/order-model.tc',
    ]);
    expect(fs.readFileSync(path.join(mat!.dir, 'order/operations/get-order.tc'), 'utf-8')).toBe(
      'GET /orders',
    );
    await mat!.cleanup();
    expect(fs.existsSync(mat!.dir)).toBe(false);
  });

  it('stores the inferred subtree as the split kind; load is independent', async () => {
    const contracts = seedCorpus(srcDir);
    await store.saveContracts(refAt('c1'), 'contracts_inferred', path.join(contracts, '_inferred'));
    const mat = await store.loadContracts(refAt('c1'), 'contracts_inferred');
    expect(listFilesRel(mat!.dir)).toEqual(['order/inferred-x.tc']);
    await mat!.cleanup();
    // authored kind for the same commit is absent
    expect(await store.loadContracts(refAt('c1'), 'contracts')).toBeNull();
  });

  it('loadContracts returns null for an unknown set', async () => {
    expect(await store.loadContracts(refAt('missing'), 'contracts')).toBeNull();
  });

  it('putContractFile adds one file; deleteContractFile removes it (promote/dismiss primitive)', async () => {
    const contracts = seedCorpus(srcDir);
    await store.saveContracts(refAt('c1'), 'contracts', contracts);

    // Promote: add one .tc to the authored set without re-snapshotting the tree.
    await store.putContractFile(refAt('c1'), 'contracts', 'order/promoted.tc', 'promoted contract');
    expect(await store.readContractFile(REPO, 'contracts', 'order/promoted.tc', 'c1')).toBe('promoted contract');
    // Existing files untouched, and it materializes with the addition.
    expect(await store.readContractFile(REPO, 'contracts', '_shared/auth.tc', 'c1')).toBe('auth requirement');
    const mat = await store.loadContracts(refAt('c1'), 'contracts');
    expect(listFilesRel(mat!.dir)).toContain('order/promoted.tc');
    await mat!.cleanup();

    // Delete it back out; deleting an absent file is a no-op.
    await store.deleteContractFile(refAt('c1'), 'contracts', 'order/promoted.tc');
    expect(await store.listContractFiles(REPO, 'contracts', 'c1')).not.toContain('order/promoted.tc');
    await store.deleteContractFile(refAt('c1'), 'contracts', 'order/promoted.tc');
  });

  it('putContractFile creates the set when absent and shares content rows', async () => {
    await store.putContractFile(refAt('c9'), 'contracts', 'a/x.tc', 'shared body');
    expect(await store.listContractFiles(REPO, 'contracts', 'c9')).toEqual(['a/x.tc']);
    // Byte-identical content at another path dedupes to one stored object.
    await store.putContractFile(refAt('c9'), 'contracts', 'b/y.tc', 'shared body');
    expect(await objCount(db)).toBe(1);
  });

  it('rejects an empty commit SHA on save', async () => {
    const contracts = seedCorpus(srcDir);
    await expect(store.saveContracts(refAt(''), 'contracts', contracts)).rejects.toThrow(/commit SHA/i);
  });

  it('dedupes identical content across commits; a one-file change writes one object', async () => {
    const contracts = seedCorpus(srcDir);
    const a = await store.saveContracts(refAt('c1'), 'contracts', contracts);
    expect(a.objectsWritten).toBe(3);
    expect(await objCount(db)).toBe(3);

    // Re-save the identical corpus at a new commit → no new objects, same hash.
    const b = await store.saveContracts(refAt('c2'), 'contracts', contracts);
    expect(b.objectsWritten).toBe(0);
    expect(b.manifestHash).toBe(a.manifestHash);
    expect(await objCount(db)).toBe(3);

    // Change exactly one contract → exactly one new object.
    const contracts2 = seedCorpus(srcDir, 'GET /orders?v=2');
    const c = await store.saveContracts(refAt('c3'), 'contracts', contracts2);
    expect(c.objectsWritten).toBe(1);
    expect(c.manifestHash).not.toBe(a.manifestHash);
    expect(await objCount(db)).toBe(4);
  });

  it('dedupes identical content WITHIN one save (two files, one object)', async () => {
    // Two distinct paths with byte-identical content → one stored object, and
    // objectsWritten counts real puts (not once per file).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dup-'));
    writeFile(dir, 'a/one.tc', 'identical body');
    writeFile(dir, 'b/two.tc', 'identical body');
    const res = await store.saveContracts(refAt('dup1'), 'contracts', dir);
    expect(res.fileCount).toBe(2);
    expect(res.objectsWritten).toBe(1); // one unique content
    expect(await objCount(db)).toBe(1);
    // both paths still materialize (the manifest maps both to the one object)
    const mat = await store.loadContracts(refAt('dup1'), 'contracts');
    expect(listFilesRel(mat!.dir)).toEqual(['a/one.tc', 'b/two.tc']);
    await mat!.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('materialize rejects path-traversal manifests and leaks no temp dir', async () => {
    const traverseStore = new PgContractStore(db);
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('tc-contracts-')).length;
    for (const bad of ['../escape.tc', '/abs.tc', 'a/../../b.tc']) {
      await db.insert(contractSets).values({
        repoKey: REPO,
        commitSha: `bad-${bad}`,
        kind: 'contracts',
        manifest: { v: 1, files: { [bad]: 'sha256-deadbeef' } },
        manifestHash: 'sha256-x',
        fileCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await expect(
        traverseStore.loadContracts({ repoKey: REPO, commitSha: `bad-${bad}` }, 'contracts'),
      ).rejects.toThrow(/unsafe|escape|absolute/i);
    }
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('tc-contracts-')).length;
    expect(after).toBe(before); // every temp dir cleaned up on rejection
  });

  it('materialize cleans up the temp dir when an object is missing', async () => {
    const contracts = seedCorpus(srcDir);
    await store.saveContracts(refAt('c1'), 'contracts', contracts);
    // Delete one underlying content object, leaving the manifest dangling.
    const [obj] = await db
      .select({ sha: content.sha })
      .from(content)
      .where(eq(content.scope, contentScope.contract(REPO)))
      .limit(1);
    await db
      .delete(content)
      .where(and(eq(content.scope, contentScope.contract(REPO)), eq(content.sha, obj!.sha)));
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('tc-contracts-')).length;
    await expect(store.loadContracts(refAt('c1'), 'contracts')).rejects.toThrow(/missing object/i);
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('tc-contracts-')).length;
    expect(after).toBe(before);
  });
});

describe('PgContractStore — workspace scope (pglite + Postgres content)', () => {
  const ORG = 'org_A';
  const wref = { workspaceOrgId: ORG };
  let client: PGlite;
  let store: PgContractStore;

  beforeEach(async () => {
    const s = setup();
    client = s.client;
    store = new PgContractStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  const corpus = {
    '_shared/auth.tc': 'auth requirement',
    'order/operations/get-order.tc': 'GET /orders',
    'order/order-model.tc': 'Order entity',
  };

  it('saves an in-memory map, then lists / reads / materializes it byte-identically', async () => {
    const res = await store.saveWorkspaceContracts(wref, 'contracts', corpus);
    expect(res.fileCount).toBe(3);
    expect(res.objectsWritten).toBe(3);
    expect(res.manifestHash).toMatch(/^sha256-/);

    expect((await store.listWorkspaceContractFiles(wref, 'contracts')).sort()).toEqual([
      '_shared/auth.tc',
      'order/operations/get-order.tc',
      'order/order-model.tc',
    ]);
    expect(await store.readWorkspaceContractFile(wref, 'contracts', 'order/operations/get-order.tc')).toBe(
      'GET /orders',
    );
    expect(await store.readWorkspaceContractFile(wref, 'contracts', 'nope.tc')).toBeNull();

    const mat = await store.loadWorkspaceContracts(wref, 'contracts');
    expect(mat).not.toBeNull();
    expect(listFilesRel(mat!.dir)).toEqual([
      '_shared/auth.tc',
      'order/operations/get-order.tc',
      'order/order-model.tc',
    ]);
    await mat!.cleanup();
    expect(fs.existsSync(mat!.dir)).toBe(false);
  });

  it('is always-latest: re-saving overwrites the set for the org', async () => {
    await store.saveWorkspaceContracts(wref, 'contracts', corpus);
    await store.saveWorkspaceContracts(wref, 'contracts', { 'only/one.tc': 'just one' });
    expect(await store.listWorkspaceContractFiles(wref, 'contracts')).toEqual(['only/one.tc']);
  });

  it('isolates orgs (one org cannot read another’s workspace contracts)', async () => {
    await store.saveWorkspaceContracts(wref, 'contracts', corpus);
    const other = { workspaceOrgId: 'org_B' };
    expect(await store.listWorkspaceContractFiles(other, 'contracts')).toEqual([]);
    expect(await store.loadWorkspaceContracts(other, 'contracts')).toBeNull();
  });

  it('rejects path-traversal relpaths on save', async () => {
    await expect(
      store.saveWorkspaceContracts(wref, 'contracts', { '../escape.tc': 'x' }),
    ).rejects.toThrow(/unsafe|escape|absolute/i);
  });
});

describe('PgInferredActionStore (pglite)', () => {
  let client: PGlite;
  let store: PgInferredActionStore;
  beforeEach(async () => {
    client = new PGlite();
    store = new PgInferredActionStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  it('round-trips actions; upsert replaces status; remove deletes', async () => {
    await store.setAction(REPO, { kind: 'Operation', identity: 'GET /x', status: 'dismissed', createdAt: '2026-01-01T00:00:00.000Z' });
    await store.setAction(REPO, { kind: 'Entity', identity: 'Order', status: 'promoted', createdAt: '2026-01-02T00:00:00.000Z' });
    expect((await store.listActions(REPO)).map((a) => `${a.kind}:${a.identity}:${a.status}`).sort()).toEqual([
      'Entity:Order:promoted',
      'Operation:GET /x:dismissed',
    ]);
    await store.setAction(REPO, { kind: 'Operation', identity: 'GET /x', status: 'promoted', createdAt: '2026-01-03T00:00:00.000Z' });
    expect((await store.listActions(REPO)).find((a) => a.identity === 'GET /x')?.status).toBe('promoted');
    await store.removeAction(REPO, 'Operation', 'GET /x');
    expect((await store.listActions(REPO)).map((a) => a.identity)).toEqual(['Order']);
    // Isolated by repoKey.
    expect(await store.listActions('other/repo')).toEqual([]);
  });
});

describe('PgSpecStore (pglite)', () => {
  let client: PGlite;
  let store: PgSpecStore;
  beforeEach(async () => {
    client = new PGlite();
    store = new PgSpecStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  it('round-trips claims + decisions; upserts; rejects empty commit', async () => {
    const ref = refAt('c1');
    expect(await store.loadSpec(ref, 'claims')).toBeNull();
    await store.saveSpec(ref, 'claims', { modules: ['a'], claims: [{ id: 1 }] });
    expect(await store.loadSpec(ref, 'claims')).toEqual({ modules: ['a'], claims: [{ id: 1 }] });
    await store.saveSpec(ref, 'claims', { modules: ['b'] });
    expect(await store.loadSpec(ref, 'claims')).toEqual({ modules: ['b'] });
    await store.saveSpec(ref, 'decisions', { decisions: [] });
    expect(await store.loadSpec(ref, 'decisions')).toEqual({ decisions: [] });
    await expect(store.saveSpec(refAt(''), 'claims', {})).rejects.toThrow(/commit SHA/i);
  });

  it('decisions are per-repo "current": saved under any ref, read back at any ref', async () => {
    // saving under c1 and reading under c2 returns the same decisions doc.
    await store.saveSpec(refAt('c1'), 'decisions', { version: 1, decisions: [{ conflictId: 'x' }] });
    expect(await store.loadSpec(refAt('c2'), 'decisions')).toEqual({
      version: 1,
      decisions: [{ conflictId: 'x' }],
    });
    expect(await store.loadLatest('acme/api', 'decisions')).toEqual({
      version: 1,
      decisions: [{ conflictId: 'x' }],
    });
    // even with an empty-commit ref decisions persist (they're per-repo).
    await store.saveSpec(refAt(''), 'decisions', { version: 1, decisions: [] });
    expect(await store.loadLatest('acme/api', 'decisions')).toEqual({ version: 1, decisions: [] });
  });

  it('loadLatest returns the most-recently-stored per-commit artifact (scan-state)', async () => {
    await store.saveSpec(refAt('c1'), 'scanState', { scannedAt: '2026-01-01', docsScanned: 1 });
    await store.saveSpec(refAt('c2'), 'scanState', { scannedAt: '2026-02-01', docsScanned: 3 });
    expect(await store.loadLatest('acme/api', 'scanState')).toEqual({
      scannedAt: '2026-02-01',
      docsScanned: 3,
    });
    expect(await store.loadLatest('other/repo', 'scanState')).toBeNull();
  });
});

describe('gcContractObjects (pglite + Postgres content)', () => {
  let client: PGlite;
  let srcDir: string;
  let store: PgContractStore;
  let db: EeDb;

  beforeEach(async () => {
    const s = setup();
    client = s.client;
    srcDir = s.srcDir;
    db = await makeDb(client);
    store = new PgContractStore(db);
  });
  afterEach(async () => {
    await client.close();
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  const contractShas = async (): Promise<string[]> =>
    (
      await db
        .select({ sha: content.sha })
        .from(content)
        .where(eq(content.scope, contentScope.contract(REPO)))
    ).map((r) => r.sha);

  it('sweeps only objects no live manifest references', async () => {
    const contracts = seedCorpus(srcDir);
    await store.saveContracts(refAt('c1'), 'contracts', contracts);
    // c2 changes one file → 4 objects exist; c1 + c2 manifests both live.
    const contracts2 = seedCorpus(srcDir, 'GET /orders?v=2');
    await store.saveContracts(refAt('c2'), 'contracts', contracts2);
    expect(await objCount(db)).toBe(4);

    // Nothing to collect while both manifests are live.
    let res = await gcContractObjects(db, REPO);
    expect(res.deleted).toBe(0);
    expect(res.live).toBe(4);

    // Drop c2's manifest row → its exclusive object (the v=2 get-order) is orphaned.
    await db.delete(contractSets).where(eq(contractSets.commitSha, 'c2'));
    res = await gcContractObjects(db, REPO);
    expect(res.deleted).toBe(1);
    expect(await objCount(db)).toBe(3);

    // c1 still fully materializes (its objects survived).
    const mat = await store.loadContracts(refAt('c1'), 'contracts');
    expect(mat).not.toBeNull();
    await mat!.cleanup();
  });

  it('protectedShas shields an unreferenced object from the sweep', async () => {
    const contracts = seedCorpus(srcDir);
    await store.saveContracts(refAt('c1'), 'contracts', contracts);
    await db.delete(contractSets); // orphan everything
    const shas = await contractShas();
    const keepSha = shas[0]!;
    const res = await gcContractObjects(db, REPO, { protectedShas: new Set([keepSha]) });
    expect(res.deleted).toBe(shas.length - 1);
    expect(await objCount(db)).toBe(1);
  });
});
