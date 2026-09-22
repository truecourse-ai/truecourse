import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgSpecStore } from '../../packages/data-store/src/index';
import {
  setSpecStore,
  resetSpecStore,
  saveWorkspaceSpec,
  loadWorkspaceSpec,
  type WorkspaceRef,
} from '@truecourse/core/lib/spec-store';

const ORG_A = 'org_aaa';
const ORG_B = 'org_bbb';

async function makeDb(client: PGlite): Promise<Db> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

describe('PgSpecStore — workspace scope (pglite)', () => {
  let client: PGlite;
  let store: PgSpecStore;

  beforeEach(async () => {
    client = new PGlite();
    store = new PgSpecStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  it('returns null for a workspace artifact that was never written', async () => {
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'corpus')).toBeNull();
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'decisions')).toBeNull();
  });

  it('round-trips the corpus and the decisions keyed by org', async () => {
    const ref: WorkspaceRef = { workspaceOrgId: ORG_A };
    await store.saveWorkspaceSpec(ref, 'corpus', { version: 3, docs: [{ ref: 'd1' }] });
    await store.saveWorkspaceSpec(ref, 'decisions', { version: 1, decisions: [] });

    expect(await store.loadWorkspaceSpec(ref, 'corpus')).toEqual({ version: 3, docs: [{ ref: 'd1' }] });
    expect(await store.loadWorkspaceSpec(ref, 'decisions')).toEqual({ version: 1, decisions: [] });
  });

  it('every corpus save is a new version: the newest is current, the older stays addressable, with provenance', async () => {
    const ref: WorkspaceRef = { workspaceOrgId: ORG_A };
    await store.saveWorkspaceSpec(ref, 'corpus', { n: 1 }, { producedByRun: 'scan-1', model: 'm1' });
    await new Promise((r) => setTimeout(r, 5));
    await store.saveWorkspaceSpec(ref, 'corpus', { n: 2 }, { producedByRun: 'scan-2', model: 'm2' });
    expect(await store.loadWorkspaceSpec(ref, 'corpus')).toEqual({ n: 2 });

    const versions = await store.listWorkspaceSpecVersions(ref, 'corpus');
    expect(versions.map((v) => [v.producedByRun, v.model, v.scope, v.sourceCommit])).toEqual([
      ['scan-2', 'm2', 'default', null],
      ['scan-1', 'm1', 'default', null],
    ]);
    expect(await store.loadWorkspaceSpec(ref, 'corpus', { id: versions[1]!.id })).toEqual({ n: 1 });
    expect(await store.readWorkspaceSpecVersion(ORG_A, 'corpus', versions[1]!.id)).toEqual(versions[1]);
    expect(await store.readWorkspaceSpecVersion(ORG_A, 'corpus', 'nope')).toBeNull();
  });

  it('a scope is its own line of versions: a candidate corpus never becomes the workspace’s current', async () => {
    await store.saveWorkspaceSpec({ workspaceOrgId: ORG_A }, 'corpus', { line: 'default' });
    await new Promise((r) => setTimeout(r, 5));
    await store.saveWorkspaceSpec(
      { workspaceOrgId: ORG_A, scope: 'pr/acme/api#7' },
      'corpus',
      { line: 'candidate' },
      { sourceCommit: 'head7' },
    );
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'corpus')).toEqual({ line: 'default' });
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_A, scope: 'pr/acme/api#7' }, 'corpus')).toEqual({
      line: 'candidate',
    });
    const [candidate] = await store.listWorkspaceSpecVersions({ workspaceOrgId: ORG_A, scope: 'pr/acme/api#7' }, 'corpus');
    expect(candidate).toMatchObject({ scope: 'pr/acme/api#7', sourceCommit: 'head7' });
  });

  it('the decisions stay one ledger: a save replaces it', async () => {
    const ref: WorkspaceRef = { workspaceOrgId: ORG_A };
    await store.saveWorkspaceSpec(ref, 'decisions', { n: 1 });
    await store.saveWorkspaceSpec(ref, 'decisions', { n: 2 });
    expect(await store.loadWorkspaceSpec(ref, 'decisions')).toEqual({ n: 2 });
  });

  it('isolates two orgs', async () => {
    await store.saveWorkspaceSpec({ workspaceOrgId: ORG_A }, 'corpus', { who: 'A' });
    await store.saveWorkspaceSpec({ workspaceOrgId: ORG_B }, 'corpus', { who: 'B' });
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'corpus')).toEqual({ who: 'A' });
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_B }, 'corpus')).toEqual({ who: 'B' });
  });
});

describe('spec-store delegators route to the installed store', () => {
  let client: PGlite;
  afterEach(async () => {
    resetSpecStore();
    await client?.close();
  });

  it('saveWorkspaceSpec/loadWorkspaceSpec hit the installed PgSpecStore', async () => {
    client = new PGlite();
    setSpecStore(new PgSpecStore(await makeDb(client)));
    await saveWorkspaceSpec({ workspaceOrgId: ORG_A }, 'corpus', { via: 'delegator' });
    expect(await loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'corpus')).toEqual({ via: 'delegator' });
  });
});
