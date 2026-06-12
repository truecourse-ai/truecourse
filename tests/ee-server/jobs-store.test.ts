import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import {
  JobStore,
  NotificationStore,
  ActiveJobExistsError,
} from '../../ee/packages/data-store/src/index';

let client: PGlite;
let db: EeDb;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterEach(async () => {
  await client.close();
});

describe('JobStore — single-flight', () => {
  it('rejects a second active job for the same (org, key), then allows one once terminal', async () => {
    const store = new JobStore(db);
    const key = 'knowledge.sync:confluence';

    const first = await store.create({ org: 'org_A', type: 'knowledge.sync', key });
    expect(first.status).toBe('queued');

    // A concurrent create for the same key is rejected with the active job's id.
    await expect(store.create({ org: 'org_A', type: 'knowledge.sync', key })).rejects.toBeInstanceOf(
      ActiveJobExistsError,
    );
    try {
      await store.create({ org: 'org_A', type: 'knowledge.sync', key });
    } catch (e) {
      expect((e as ActiveJobExistsError).existing.id).toBe(first.id);
    }

    // A DIFFERENT org with the same key is independent (scoped by org).
    const otherOrg = await store.create({ org: 'org_B', type: 'knowledge.sync', key });
    expect(otherOrg.id).not.toBe(first.id);

    // Once the first job reaches a terminal state, the key frees and a new run is allowed.
    await store.markSucceeded(first.id, { synced: 3 });
    const second = await store.create({ org: 'org_A', type: 'knowledge.sync', key });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('queued');
  });

  it('tracks lifecycle + progress and exposes active jobs', async () => {
    const store = new JobStore(db);
    const job = await store.create({ org: 'org_A', type: 'knowledge.sync', key: 'k' });

    await store.markRunning(job.id);
    const mid = await store.setProgress(job.id, { current: 2, total: 5, message: 'Fetching' });
    expect(mid?.status).toBe('running');
    expect(mid?.progress).toEqual({ current: 2, total: 5, message: 'Fetching' });

    // Active + key lookups see the running job.
    expect((await store.listActive('org_A')).map((j) => j.id)).toEqual([job.id]);
    expect((await store.listActive('org_A', 'knowledge.sync')).length).toBe(1);
    expect((await store.getActiveByKey('org_A', 'k'))?.id).toBe(job.id);

    const done = await store.markSucceeded(job.id, { synced: 5 });
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ synced: 5 });
    expect(await store.listActive('org_A')).toEqual([]);
    expect(await store.getActiveByKey('org_A', 'k')).toBeNull();
  });

  it('failOrphaned reaps queued/running jobs (boot recovery) and frees the key', async () => {
    const store = new JobStore(db);
    const a = await store.create({ org: 'org_A', type: 'knowledge.sync', key: 'a' });
    const b = await store.create({ org: 'org_A', type: 'knowledge.sync', key: 'b' });
    await store.markRunning(b.id);

    const reaped = await store.failOrphaned();
    expect(reaped).toBe(2);
    expect(await store.listActive('org_A')).toEqual([]);
    expect((await store.get(a.id))?.status).toBe('failed');

    // The freed key accepts a fresh job.
    const fresh = await store.create({ org: 'org_A', type: 'knowledge.sync', key: 'a' });
    expect(fresh.status).toBe('queued');
  });

  it('get is org-scoped so one workspace cannot read another\'s job', async () => {
    const store = new JobStore(db);
    const job = await store.create({ org: 'org_A', type: 'knowledge.sync', key: 'k' });
    expect((await store.get(job.id, 'org_A'))?.id).toBe(job.id);
    expect(await store.get(job.id, 'org_B')).toBeNull();
  });
});

describe('NotificationStore', () => {
  it('adds, lists newest-first, and tracks unread/read state per org', async () => {
    const store = new NotificationStore(db);

    const n1 = await store.add({ org: 'org_A', kind: 'knowledge.sync', level: 'success', title: 'Sync complete', body: 'Synced 4 documents.' });
    const n2 = await store.add({ org: 'org_A', kind: 'knowledge.sync', level: 'error', title: 'Sync failed' });
    await store.add({ org: 'org_B', kind: 'knowledge.sync', level: 'info', title: 'Other workspace' });

    const list = await store.listForOrg('org_A');
    expect(list.map((n) => n.title)).toEqual(['Sync failed', 'Sync complete']); // newest first
    expect(list.every((n) => n.readAt === null)).toBe(true);
    expect(await store.unreadCount('org_A')).toBe(2);

    // Org scoping: org_B's notification is not visible to org_A.
    expect((await store.listForOrg('org_A')).some((n) => n.title === 'Other workspace')).toBe(false);

    await store.markRead('org_A', [n2.id]);
    expect(await store.unreadCount('org_A')).toBe(1);

    await store.markAllRead('org_A');
    expect(await store.unreadCount('org_A')).toBe(0);
    // org_B untouched.
    expect(await store.unreadCount('org_B')).toBe(1);

    // First-added carries the success payload back.
    const reloaded = (await store.listForOrg('org_A')).find((n) => n.id === n1.id);
    expect(reloaded?.level).toBe('success');
    expect(reloaded?.body).toBe('Synced 4 documents.');
  });
});
