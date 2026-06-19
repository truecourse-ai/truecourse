import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { IntegrationStore } from '../../ee/packages/server/src/integrations/store';

const SECRET = 'master-secret-at-least-32-characters!!';
const ORG_A = 'org_aaa';
const ORG_B = 'org_bbb';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

const config = {
  baseUrl: 'https://acme.atlassian.net',
  spaceKey: 'ENG',
  accountEmail: 'u@acme.test',
};

describe('IntegrationStore (pglite)', () => {
  let client: PGlite;
  let store: IntegrationStore;
  let db: EeDb;

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
});
