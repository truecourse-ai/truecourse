/**
 * Boot recovery on graphile's side: a process killed mid-run leaves the QUEUE
 * its job was claimed from locked, and graphile would not free it for four
 * hours — long enough to strand every job enqueued behind it. So the boot that
 * fails the orphaned rows also unlocks what the dead workers held.
 *
 * graphile's schema is stood up here by hand (the real one is installed by the
 * worker's own migrations): the `jobs` view the lock reader reads and the
 * `force_unlock_workers` function it calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { schema, type Db } from '@truecourse/db';
import { releaseAbandonedQueueLocks } from '@truecourse/jobs';

let client: PGlite;
let db: Db;

beforeEach(() => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
});

afterEach(async () => {
  await client.close();
});

/** graphile's surface, as much of it as the release path touches. */
async function installGraphileSchema(): Promise<void> {
  await client.exec(`
    create schema graphile_worker;
    create table graphile_worker.jobs (id serial primary key, locked_by text);
    create table graphile_worker.queues (queue_name text primary key, locked_by text);
    create function graphile_worker.force_unlock_workers(worker_ids text[]) returns void
      language sql as $$
        update graphile_worker.jobs set locked_by = null where locked_by = any(worker_ids);
        update graphile_worker.queues set locked_by = null where locked_by = any(worker_ids);
      $$;
  `);
}

const lockedQueues = async (): Promise<number> => {
  const { rows } = await client.query<{ count: number }>(
    'select count(*)::int as count from graphile_worker.queues where locked_by is not null',
  );
  return rows[0]?.count ?? 0;
};

describe('releaseAbandonedQueueLocks', () => {
  it('frees the queues the dead workers held', async () => {
    await installGraphileSchema();
    await client.exec(`
      insert into graphile_worker.jobs (locked_by) values ('worker-1'), ('worker-1'), ('worker-2');
      insert into graphile_worker.jobs (locked_by) values (null);
      insert into graphile_worker.queues values ('heavy:org_A', 'worker-1'), ('heavy:org_B', 'worker-2');
    `);

    expect(await releaseAbandonedQueueLocks(db)).toBe(2);
    expect(await lockedQueues()).toBe(0);
  });

  it('does nothing when no lock is held', async () => {
    await installGraphileSchema();
    await client.exec(`insert into graphile_worker.jobs (locked_by) values (null);`);

    expect(await releaseAbandonedQueueLocks(db)).toBe(0);
  });

  it('is a no-op before the worker has ever installed its schema', async () => {
    // The first boot of a fresh database: nothing to read, and no error either.
    expect(await releaseAbandonedQueueLocks(db)).toBe(0);
  });

  it('never stops the boot when the release itself fails', async () => {
    await client.exec(`
      create schema graphile_worker;
      create table graphile_worker.jobs (id serial primary key, locked_by text);
      insert into graphile_worker.jobs (locked_by) values ('worker-1');
    `);
    // No force_unlock_workers function — the call throws, the boot carries on.
    expect(await releaseAbandonedQueueLocks(db)).toBe(0);
    const { rows } = await db.execute(
      sql`select count(*)::int as count from graphile_worker.jobs where locked_by is not null`,
    );
    expect((rows[0] as { count: number }).count).toBe(1);
  });
});
