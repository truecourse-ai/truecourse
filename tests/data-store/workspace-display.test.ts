/** Workspace display preferences survive profile edits and stay scoped to their workspace. */
import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgWorkspaceProfileStore } from '../../packages/data-store/src/workspace-profile-store';

it('persists the display preference independently of the scan description', async () => {
  const client = new PGlite();
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const store = new PgWorkspaceProfileStore(db as unknown as Db);
    expect(await store.setShowBlocked('missing', true)).toBeNull();
    const initial = await store.save('one', 'An inventory product');
    await store.save('two', 'Another product');
    expect(initial.showBlocked).toBe(false);
    const updated = await store.setShowBlocked('one', true);
    expect(updated).toEqual({ ...initial, showBlocked: true });
    const reread = new PgWorkspaceProfileStore(db as unknown as Db);
    expect((await reread.get('one'))?.showBlocked).toBe(true);
    expect((await reread.get('two'))?.showBlocked).toBe(false);
    expect((await store.save('one', 'The revised product'))?.showBlocked).toBe(true);
    await store.setShowBlocked('one', false);
    expect((await reread.get('one'))?.showBlocked).toBe(false);
  } finally {
    await client.close();
  }
});
