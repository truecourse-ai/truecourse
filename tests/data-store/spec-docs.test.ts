/**
 * The scan's DOCUMENT SNAPSHOT in the hosted spec store: the kept documents'
 * bodies, content-addressed under the corpus commit, read back by ref — the
 * exact commit when asked for, else the newest scan's. What lets a connected
 * repository open a document without a working tree.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, content, type Db } from '@truecourse/db';
import { PgSpecStore } from '../../packages/data-store/src/index';

const REPO = 'acme/api';

let client: PGlite;
let db: Db;
let store: PgSpecStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new PgSpecStore(db);
});
afterEach(async () => {
  await client.close();
});

const specObjects = async (): Promise<number> =>
  (await db.select({ sha: content.sha }).from(content).where(eq(content.scope, `spec:${REPO}`))).length;

describe('PgSpecStore document snapshot', () => {
  it('round-trips a document by ref at the commit it was scanned', async () => {
    await store.saveSpecDocs(
      { repoKey: REPO, commitSha: 'shaA' },
      { 'docs/orders.md': '# Orders\n', '.truecourse/specs/sources/stripe/refunds.md': '# Refunds\n' },
    );
    expect(await store.loadSpecDoc(REPO, 'docs/orders.md', 'shaA')).toBe('# Orders\n');
    expect(await store.loadSpecDoc(REPO, '.truecourse/specs/sources/stripe/refunds.md', 'shaA')).toBe('# Refunds\n');
    expect(await store.loadSpecDoc(REPO, 'docs/missing.md', 'shaA')).toBeNull();
    expect(await store.loadSpecDoc(REPO, 'docs/orders.md', 'shaZ')).toBeNull();
    expect(await store.loadSpecDoc('other/repo', 'docs/orders.md')).toBeNull();
  });

  it('answers from the newest snapshot when no commit is given, and dedups unchanged bodies', async () => {
    await store.saveSpecDocs({ repoKey: REPO, commitSha: 'shaA' }, { 'docs/orders.md': '# Orders\n' });
    await store.saveSpecDocs(
      { repoKey: REPO, commitSha: 'shaB' },
      { 'docs/orders.md': '# Orders\n', 'docs/refunds.md': '# Refunds\n' },
    );
    expect(await store.loadSpecDoc(REPO, 'docs/refunds.md')).toBe('# Refunds\n');
    expect(await store.loadSpecDoc(REPO, 'docs/refunds.md', 'shaA')).toBeNull();
    // Two manifests, two distinct bodies: the unchanged document was stored once.
    expect(await specObjects()).toBe(4);
  });
});
