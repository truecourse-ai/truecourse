import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import {
  PgRepoConfigStore,
  PgUiStateStore,
  PgRegistryStore,
} from '../../ee/packages/data-store/src/index';
import type { ProjectConfig } from '@truecourse/core/config/project-config';
import type { UiState } from '@truecourse/core/config/ui-state';

const REPO = 'workspace-1/my-repo';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

describe('PgRepoConfigStore (pglite)', () => {
  let client: PGlite;
  let store: PgRepoConfigStore;
  beforeEach(async () => {
    client = new PGlite();
    store = new PgRepoConfigStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  it('returns {} for an unknown repo', async () => {
    expect(await store.readProjectConfig(REPO)).toEqual({});
  });

  it('writes, reads, and upserts config; scoped per repo', async () => {
    const cfg: ProjectConfig = { enableLlmRules: false, disabledRules: ['a/b'] };
    await store.writeProjectConfig(REPO, cfg);
    expect(await store.readProjectConfig(REPO)).toEqual(cfg);

    const next: ProjectConfig = { enableLlmRules: true, enabledCategories: ['security'] };
    await store.writeProjectConfig(REPO, next);
    expect(await store.readProjectConfig(REPO)).toEqual(next);

    // a different repo is unaffected
    expect(await store.readProjectConfig('other')).toEqual({});
  });
});

describe('PgUiStateStore (pglite)', () => {
  let client: PGlite;
  let store: PgUiStateStore;
  beforeEach(async () => {
    client = new PGlite();
    store = new PgUiStateStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  it('returns empty state for an unknown repo', async () => {
    expect(await store.readUiState(REPO)).toEqual({ positions: {}, collapsed: {} });
  });

  it('writes, reads, and upserts ui-state; fills missing halves on read', async () => {
    const state: UiState = {
      positions: { 'main/services': { svc: { x: 1, y: 2 } } },
      collapsed: { 'main/modules': ['mod-a'] },
    };
    await store.writeUiState(REPO, state);
    expect(await store.readUiState(REPO)).toEqual(state);

    // a payload missing `collapsed` reads back with an empty `collapsed`
    await store.writeUiState(REPO, { positions: { x: {} } } as unknown as UiState);
    expect(await store.readUiState(REPO)).toEqual({ positions: { x: {} }, collapsed: {} });
  });
});

describe('PgRegistryStore (pglite)', () => {
  let client: PGlite;
  let store: PgRegistryStore;
  beforeEach(async () => {
    client = new PGlite();
    store = new PgRegistryStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  it('registers, looks up by slug + path, and de-dups slugs on collision', async () => {
    const a = await store.registerProject('/a/myrepo');
    expect(a).toMatchObject({ slug: 'myrepo', name: 'myrepo', path: '/a/myrepo' });
    expect(a.lastOpened).toBeTruthy();

    // same basename, different path → slug is suffixed
    const b = await store.registerProject('/b/myrepo');
    expect(b.slug).toBe('myrepo-2');

    expect((await store.getProjectBySlug('myrepo'))?.path).toBe('/a/myrepo');
    expect((await store.getProjectByPath('/b/myrepo'))?.slug).toBe('myrepo-2');
    expect(await store.getProjectBySlug('nope')).toBeNull();
    expect(await store.getProjectByPath('/no/such')).toBeNull();

    const all = await store.readRegistry();
    expect(all.map((p) => p.slug).sort()).toEqual(['myrepo', 'myrepo-2']);
    // prune is a server-side no-op: returns the full set
    expect((await store.pruneStaleProjects()).length).toBe(2);
  });

  it('re-registering an existing path refreshes name + lastOpened, keeps slug', async () => {
    const first = await store.registerProject('/a/myrepo', 'Original');
    const second = await store.registerProject('/a/myrepo', 'Renamed');
    expect(second.slug).toBe(first.slug);
    expect(second.name).toBe('Renamed');
    expect((await store.readRegistry()).length).toBe(1);
  });

  it('uses an explicit display name when provided', async () => {
    const e = await store.registerProject('/some/path', 'My Service');
    expect(e.name).toBe('My Service');
    expect(e.slug).toBe('my-service');
  });

  it('touchProject + setLastAnalyzed update timestamps; unregister returns found/not-found', async () => {
    await store.registerProject('/a/myrepo');
    await store.setLastAnalyzed('myrepo', '2026-05-01T00:00:00.000Z');
    expect((await store.getProjectBySlug('myrepo'))?.lastAnalyzed).toBe('2026-05-01T00:00:00.000Z');

    await store.touchProject('myrepo'); // no throw; updates lastOpened
    await store.touchProject('ghost'); // no-op for unknown slug

    expect(await store.unregisterProject('ghost')).toBe(false);
    expect(await store.unregisterProject('myrepo')).toBe(true);
    expect(await store.readRegistry()).toEqual([]);
  });
});
