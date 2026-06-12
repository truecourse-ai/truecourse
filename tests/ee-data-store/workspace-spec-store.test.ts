import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore } from '../../ee/packages/data-store/src/index';
import {
  setSpecStore,
  resetSpecStore,
  saveWorkspaceSpec,
  loadWorkspaceSpec,
  type WorkspaceRef,
} from '@truecourse/core/lib/spec-store';

const ORG_A = 'org_aaa';
const ORG_B = 'org_bbb';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
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
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'claims')).toBeNull();
  });

  it('round-trips claims/decisions/scanState keyed by org (no commit dimension)', async () => {
    const ref: WorkspaceRef = { workspaceOrgId: ORG_A };
    await store.saveWorkspaceSpec(ref, 'claims', { version: 1, claims: [{ id: 'c1' }] });
    await store.saveWorkspaceSpec(ref, 'decisions', { version: 1, decisions: [] });
    await store.saveWorkspaceSpec(ref, 'scanState', { scannedAt: 'now', openConflicts: [] });

    expect(await store.loadWorkspaceSpec(ref, 'claims')).toEqual({
      version: 1,
      claims: [{ id: 'c1' }],
    });
    expect(await store.loadWorkspaceSpec(ref, 'decisions')).toEqual({ version: 1, decisions: [] });
    expect(await store.loadWorkspaceSpec(ref, 'scanState')).toEqual({
      scannedAt: 'now',
      openConflicts: [],
    });
  });

  it('upsert overwrites the single current row per (org, artifact)', async () => {
    const ref: WorkspaceRef = { workspaceOrgId: ORG_A };
    await store.saveWorkspaceSpec(ref, 'claims', { n: 1 });
    await store.saveWorkspaceSpec(ref, 'claims', { n: 2 });
    expect(await store.loadWorkspaceSpec(ref, 'claims')).toEqual({ n: 2 });
  });

  it('isolates two orgs', async () => {
    await store.saveWorkspaceSpec({ workspaceOrgId: ORG_A }, 'claims', { who: 'A' });
    await store.saveWorkspaceSpec({ workspaceOrgId: ORG_B }, 'claims', { who: 'B' });
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'claims')).toEqual({ who: 'A' });
    expect(await store.loadWorkspaceSpec({ workspaceOrgId: ORG_B }, 'claims')).toEqual({ who: 'B' });
  });

  it('rejects verifyState (a per-commit repo artifact with no workspace analogue)', async () => {
    await expect(
      store.saveWorkspaceSpec({ workspaceOrgId: ORG_A }, 'verifyState', {}),
    ).rejects.toThrow(/verifyState is repo-scoped only/);
  });
});

describe('FileSpecStore — workspace scope is enterprise-only (OSS unaffected)', () => {
  beforeEach(() => resetSpecStore());
  afterEach(() => resetSpecStore());

  it('saveWorkspaceSpec throws (a caller that reached here is mis-wired)', async () => {
    await expect(
      saveWorkspaceSpec({ workspaceOrgId: ORG_A }, 'claims', {}),
    ).rejects.toThrow(/require the enterprise store/);
  });

  it('loadWorkspaceSpec returns null (so effective reads degrade to repo-only)', async () => {
    expect(await loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'claims')).toBeNull();
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
    await saveWorkspaceSpec({ workspaceOrgId: ORG_A }, 'claims', { via: 'delegator' });
    expect(await loadWorkspaceSpec({ workspaceOrgId: ORG_A }, 'claims')).toEqual({ via: 'delegator' });
  });
});
