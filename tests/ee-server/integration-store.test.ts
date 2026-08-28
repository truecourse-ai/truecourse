import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { IntegrationPendingView } from '@truecourse/shared';
import { IntegrationStore } from '../../ee/packages/server/src/integrations/store';

const SECRET = 'master-secret-at-least-32-characters!!';
const ORG_A = 'org_aaa';
const ORG_B = 'org_bbb';

async function makeDb(client: PGlite): Promise<Db> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

const config = {
  baseUrl: 'https://acme.atlassian.net',
  spaceKey: 'ENG',
  accountEmail: 'u@acme.test',
};

describe('IntegrationStore (pglite)', () => {
  let client: PGlite;
  let store: IntegrationStore;
  let db: Db;

  beforeEach(async () => {
    client = new PGlite();
    db = await makeDb(client);
    store = new IntegrationStore(db, SECRET);
  });
  afterEach(async () => {
    await client.close();
  });

  it('returns null when unconfigured', async () => {
    expect(await store.getView(ORG_A, 'confluence')).toBeNull();
    expect(await store.getConnection(ORG_A, 'confluence')).toBeNull();
  });

  it('encrypts the token at rest: getConnection decrypts it, getView only masks it', async () => {
    await store.save(ORG_A, 'confluence', { config, token: 'tok-ABCD1234' });

    const conn = await store.getConnection(ORG_A, 'confluence');
    expect(conn?.token).toBe('tok-ABCD1234'); // decrypted for the connector
    expect(conn?.config).toEqual(config);

    const view = await store.getView(ORG_A, 'confluence');
    expect(view).toMatchObject({ hasToken: true, tokenMask: '••••1234', config });
    expect(JSON.stringify(view)).not.toContain('tok-ABCD1234'); // never leaves masked
  });

  it('omitting the token on a later save keeps the stored token', async () => {
    await store.save(ORG_A, 'confluence', { config, token: 'tok-keepme9' });
    await store.save(ORG_A, 'confluence', { config: { ...config, spaceKey: 'DOCS' } }); // no token
    const conn = await store.getConnection(ORG_A, 'confluence');
    expect(conn?.token).toBe('tok-keepme9');
    expect(conn?.config.spaceKey).toBe('DOCS'); // non-secret config still updated
  });

  it('masks to •••• (never crashes) when the master secret no longer matches', async () => {
    await store.save(ORG_A, 'confluence', { config, token: 'tok-rotated1' });
    const wrongStore = new IntegrationStore(db, 'a-completely-different-master-secret-x');
    const view = await wrongStore.getView(ORG_A, 'confluence');
    expect(view?.hasToken).toBe(true);
    expect(view?.tokenMask).toBe('••••');
  });

  it('isolates orgs and deletes', async () => {
    await store.save(ORG_A, 'confluence', { config, token: 'tok-a' });
    expect(await store.getView(ORG_B, 'confluence')).toBeNull();

    await store.delete(ORG_A, 'confluence');
    expect(await store.getView(ORG_A, 'confluence')).toBeNull();
  });

  describe('pending (sweep-awaiting-Process record)', () => {
    const pending: IntegrationPendingView = {
      delta: { new: 3, changed: 2, removed: 0, total: 40 },
      estimate: {
        totalEstimatedTokens: 1234,
        tiers: [],
        stages: [{ stage: 'scan', model: 'claude', calls: 2, estimatedTokens: 1234, estimatedCostUsd: 4.2 }],
        subjectLabel: '3 new · 2 changed of 40 docs',
        estimatedCostUsd: 4.2,
        costPartial: true,
      },
      sweptAt: '2026-02-02T00:00:00Z',
    };

    it('is null on a fresh connection, round-trips through setPending, and clears with null', async () => {
      await store.save(ORG_A, 'confluence', { config, token: 'tok-a' });
      expect((await store.getView(ORG_A, 'confluence'))?.pending).toBeNull();

      await store.setPending(ORG_A, 'confluence', pending);
      expect((await store.getView(ORG_A, 'confluence'))?.pending).toEqual(pending);

      await store.setPending(ORG_A, 'confluence', null);
      expect((await store.getView(ORG_A, 'confluence'))?.pending).toBeNull();
    });

    it('save() does not clobber a stored pending record', async () => {
      await store.save(ORG_A, 'confluence', { config, token: 'tok-a' });
      await store.setPending(ORG_A, 'confluence', pending);

      // A later save (e.g. rotating the token / editing config) must leave pending intact.
      await store.save(ORG_A, 'confluence', { config: { ...config, spaceKey: 'DOCS' }, token: 'tok-b' });

      const view = await store.getView(ORG_A, 'confluence');
      expect(view?.pending).toEqual(pending);
      expect(view?.config.spaceKey).toBe('DOCS'); // config still updated
      expect((await store.getConnection(ORG_A, 'confluence'))?.token).toBe('tok-b'); // token rotated
    });
  });
});
