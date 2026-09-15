/**
 * THE BOOT SWEEP — what a restart leaves behind, settled with ONE word.
 *
 * A server restart kills the in-process worker, so a job that was queued or
 * running dies with it, and so does the RUN record it was carrying. Those are
 * two rows describing one event, and they used to disagree: the job was marked
 * `failed` while the run was marked `interrupted`, so Activity read as "the work
 * failed" beside "the work was interrupted". Both now settle `interrupted`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR, activityRuns, type Db } from '@truecourse/db';
import { JobStore, PgSessionRunStore } from '../../packages/data-store/src/index';

let client: PGlite;
let db: Db;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterEach(async () => {
  await client.close();
});

describe('the boot sweep settles a dead process’s work', () => {
  it('marks the abandoned job and its run `interrupted`, and frees the single-flight key', async () => {
    const jobs = new JobStore(db);
    const runs = new PgSessionRunStore(db);
    const repoKey = 'acme/api';

    const queued = await jobs.create({ org: 'org_A', type: 'repo.guard-run', key: 'run:acme/api' });
    const running = await jobs.create({ org: 'org_A', type: 'context.sync', key: 'sync:site' });
    await jobs.markRunning(running.id);

    const run = await runs.create(repoKey, { command: 'guard-generate', gitRef: 'abc123' });
    // The lease a live writer renews; a dead process stops renewing it.
    await db
      .update(activityRuns)
      .set({ leaseUntil: sql`CURRENT_TIMESTAMP - interval '1 minute'` })
      .where(eq(activityRuns.runId, run.runId));

    // Boot: the queue settles its rows, the run store settles its own.
    const reaped = await jobs.interruptOrphaned();
    await runs.reconcileAll();

    expect(reaped.map((j) => j.id).sort()).toEqual([queued.id, running.id].sort());
    for (const id of [queued.id, running.id]) {
      const row = await jobs.get(id);
      expect(row?.status).toBe('interrupted');
      expect(row?.error).toBe('interrupted by a server restart');
      expect(row?.finishedAt).not.toBeNull();
    }

    const [after] = await runs.list(repoKey);
    expect(after.status).toBe('interrupted');
    expect(after.finishedAt).toBeTruthy();

    // The key is free: the next boot's work can be enqueued again.
    const again = await jobs.create({ org: 'org_A', type: 'repo.guard-run', key: 'run:acme/api' });
    expect(again.id).not.toBe(queued.id);
  });

  it('leaves a settled job and a live run alone', async () => {
    const jobs = new JobStore(db);
    const runs = new PgSessionRunStore(db);
    const repoKey = 'acme/api';

    const done = await jobs.create({ org: 'org_A', type: 'context.scan', key: 'scan' });
    await jobs.markSucceeded(done.id, { scanned: 2 });
    // A run whose lease is still in the future belongs to a process that is alive.
    const live = await runs.create(repoKey, { command: 'spec-scan', gitRef: 'abc123' });

    expect(await jobs.interruptOrphaned()).toEqual([]);
    await runs.reconcileAll();

    expect((await jobs.get(done.id))?.status).toBe('succeeded');
    expect((await runs.list(repoKey)).find((r) => r.runId === live.runId)?.status).toBe('running');
  });
});
