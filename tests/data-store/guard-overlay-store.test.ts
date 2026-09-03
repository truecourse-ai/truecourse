/**
 * The hosted overlay store: a repo's supplied-dependency overlays as one row,
 * encrypted at rest — a round trip, no plaintext in the table, an empty write
 * that clears the row, and the purge on disconnect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, guardDependencyOverlays, type Db } from '@truecourse/db';
import { PgGuardOverlayStore, purgeRepoData } from '../../packages/data-store/src/index';
import type { GuardOverlays } from '@truecourse/core/lib/guard-overlays';

const REPO = 'acme/api';
const SECRET = 'master-secret-at-least-32-chars-long!!';

let client: PGlite;
let db: Db;
let store: PgGuardOverlayStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new PgGuardOverlayStore(db, SECRET);
});
afterEach(async () => {
  await client.close();
});

const OVERLAYS: GuardOverlays = {
  dependencies: { anthropic: { env: { ANTHROPIC_API_KEY: 'sk-test-not-real' } } },
  externals: { stripe: { token: 'sk_live_not_real', headers: { 'X-Tenant': 'acme' } } },
};

const rows = () =>
  db.select().from(guardDependencyOverlays).where(eq(guardDependencyOverlays.repoKey, REPO));

describe('PgGuardOverlayStore', () => {
  it('reads null until something is registered', async () => {
    expect(await store.read(REPO)).toBeNull();
  });

  it('round-trips both overlays, and keeps no plaintext in the row', async () => {
    await store.write(REPO, OVERLAYS);
    expect(await store.read(REPO)).toEqual(OVERLAYS);

    const [row] = await rows();
    expect(row.overlaysEnc.startsWith('v1:')).toBe(true);
    expect(row.overlaysEnc).not.toContain('sk-test-not-real');
    expect(row.overlaysEnc).not.toContain('sk_live_not_real');
    expect(row.overlaysEnc).not.toContain('anthropic');
  });

  it('a later write replaces the row; an empty one clears it', async () => {
    await store.write(REPO, OVERLAYS);
    await store.write(REPO, { dependencies: { anthropic: { env: { ANTHROPIC_API_KEY: 'sk-2' } } }, externals: {} });
    expect((await store.read(REPO))?.dependencies.anthropic?.env).toEqual({ ANTHROPIC_API_KEY: 'sk-2' });
    expect((await store.read(REPO))?.externals).toEqual({});

    await store.write(REPO, { dependencies: {}, externals: {} });
    expect(await rows()).toHaveLength(0);
    expect(await store.read(REPO)).toBeNull();
  });

  it('refuses a blob another master secret wrote, rather than reading nothing', async () => {
    await store.write(REPO, OVERLAYS);
    const other = new PgGuardOverlayStore(db, 'a-different-master-secret-32-chars!!');
    await expect(other.read(REPO)).rejects.toThrow();
  });

  it('is keyed by repo, and goes with the repo on purge', async () => {
    await store.write(REPO, OVERLAYS);
    await store.write('other/repo', OVERLAYS);
    await purgeRepoData(db, REPO);
    expect(await store.read(REPO)).toBeNull();
    expect(await store.read('other/repo')).toEqual(OVERLAYS);
  });
});
