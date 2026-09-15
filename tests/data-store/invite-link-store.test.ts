/**
 * The invite-link store: a link is minted with a fresh token, stands until
 * redeemed, is redeemed exactly once and never past its date, comes back when
 * a redemption's membership failed, and is revoked only by its own workspace.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgInviteLinkStore } from '../../packages/data-store/src/index';

const ORG = 'org_acme';
const DAY = 24 * 60 * 60 * 1000;
const inWeek = () => new Date(Date.now() + 7 * DAY).toISOString();
const yesterday = () => new Date(Date.now() - DAY).toISOString();

let client: PGlite;
let store: PgInviteLinkStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  store = new PgInviteLinkStore(d as unknown as Db);
});
afterEach(async () => {
  await client.close();
});

describe('PgInviteLinkStore', () => {
  it('mints a link with its own token and lists it as standing', async () => {
    const a = await store.create({ workspaceOrgId: ORG, inviterUserId: 'user_1', inviterName: 'Dana Rees', expiresAt: inWeek() });
    const b = await store.create({ workspaceOrgId: ORG, inviterUserId: 'user_1', inviterName: 'Dana Rees', expiresAt: inWeek() });

    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.consumedAt).toBeNull();
    expect(a.inviterName).toBe('Dana Rees');
    expect(await store.findByToken(a.token)).toEqual(a);
    expect((await store.listOpen(ORG)).map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
    expect(await store.listOpen('org_other')).toEqual([]);
  });

  it('redeems a link exactly once', async () => {
    const link = await store.create({ workspaceOrgId: ORG, inviterUserId: 'user_1', inviterName: 'Dana Rees', expiresAt: inWeek() });

    const first = await store.consume(link.token, 'user_a');
    const second = await store.consume(link.token, 'user_b');

    expect(first).toMatchObject({ id: link.id, consumedByUserId: 'user_a' });
    expect(first?.consumedAt).not.toBeNull();
    expect(second).toBeNull();
    expect(await store.listOpen(ORG)).toEqual([]);
    expect((await store.findByToken(link.token))?.consumedByUserId).toBe('user_a');
  });

  it('redeems neither an expired link nor an unknown token, but still lists the expired one', async () => {
    const old = await store.create({ workspaceOrgId: ORG, inviterUserId: 'user_1', inviterName: 'Dana Rees', expiresAt: yesterday() });

    expect(await store.consume(old.token, 'user_a')).toBeNull();
    expect(await store.consume('no-such-token', 'user_a')).toBeNull();
    expect((await store.findByToken(old.token))?.consumedAt).toBeNull();
    // Expired links stay rows until revoked, so the Members list can show them as such.
    expect((await store.listOpen(ORG)).map((l) => l.id)).toEqual([old.id]);
  });

  it('releases a redeemed link so it stands again', async () => {
    const link = await store.create({ workspaceOrgId: ORG, inviterUserId: 'user_1', inviterName: 'Dana Rees', expiresAt: inWeek() });
    await store.consume(link.token, 'user_a');

    await store.release(link.id);

    expect(await store.findByToken(link.token)).toMatchObject({ consumedAt: null, consumedByUserId: null });
    expect(await store.consume(link.token, 'user_b')).toMatchObject({ consumedByUserId: 'user_b' });
  });

  it('deletes only the workspace’s own link', async () => {
    const mine = await store.create({ workspaceOrgId: ORG, inviterUserId: 'user_1', inviterName: 'Dana Rees', expiresAt: inWeek() });
    const theirs = await store.create({ workspaceOrgId: 'org_other', inviterUserId: 'user_2', inviterName: null, expiresAt: inWeek() });

    expect(await store.delete(ORG, theirs.id)).toBe(false);
    expect(await store.delete(ORG, mine.id)).toBe(true);
    expect(await store.delete(ORG, mine.id)).toBe(false);

    expect(await store.findByToken(mine.token)).toBeNull();
    expect(await store.findByToken(theirs.token)).not.toBeNull();
  });
});
