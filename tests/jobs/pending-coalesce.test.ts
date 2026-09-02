/**
 * The coalesce-then-rerun core: a request that loses the single-flight race is
 * not dropped but recorded as the subject's pending follow-up (latest wins), and
 * a crash's leftovers are drained at boot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore } from '@truecourse/data-store';
import { drainCoalesced, enqueueOrPendCoalesced } from '@truecourse/jobs';

const ORG = 'org_A';
const REPO = 'acme/api';
const TASK = 'repo.scan';
const jobKey = (repo: string) => `${TASK}:${repo}`;

interface Req {
  repoFullName: string;
  workspaceOrgId: string;
  commitSha: string;
}

/** The pending buffer the core writes through — one row per subject, latest wins. */
function fakePending() {
  const rows = new Map<string, Req>();
  return {
    rows,
    async upsert(req: Req) {
      rows.set(req.repoFullName, req);
    },
    async drain() {
      const all = [...rows.values()];
      rows.clear();
      return all;
    },
  };
}

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

const req = (commitSha: string): Req => ({ repoFullName: REPO, workspaceOrgId: ORG, commitSha });

describe('enqueueOrPendCoalesced', () => {
  it('enqueues normally when nothing holds the key', async () => {
    const jobStore = new JobStore(db);
    const pending = fakePending();
    const addJob = vi.fn(async () => {});

    const id = await enqueueOrPendCoalesced(TASK, jobKey, { jobStore, pending, addJob }, req('c1'));

    expect(id).toBeTruthy();
    expect(addJob).toHaveBeenCalledWith(id, expect.objectContaining({ commitSha: 'c1' }), jobKey(REPO));
    expect(pending.rows.size).toBe(0);
  });

  it('records the follow-up instead of dropping it when the key is held — latest wins', async () => {
    const jobStore = new JobStore(db);
    const pending = fakePending();
    const addJob = vi.fn(async () => {});
    const deps = { jobStore, pending, addJob };
    await jobStore.create({ org: ORG, type: TASK, key: jobKey(REPO) });

    expect(await enqueueOrPendCoalesced(TASK, jobKey, deps, req('c1'))).toBeNull();
    expect(await enqueueOrPendCoalesced(TASK, jobKey, deps, req('c2'))).toBeNull();

    expect(addJob).not.toHaveBeenCalled();
    expect(pending.rows.get(REPO)).toMatchObject({ commitSha: 'c2' });
  });

  it('marks the tracked row failed (freeing the key) and rethrows when addJob throws', async () => {
    const jobStore = new JobStore(db);
    const pending = fakePending();
    const addJob = vi.fn(async () => {
      throw new Error('graphile down');
    });
    const deps = { jobStore, pending, addJob };

    await expect(enqueueOrPendCoalesced(TASK, jobKey, deps, req('c1'))).rejects.toThrow('graphile down');

    // The row must not sit 'queued' holding the key with no graphile job to
    // settle it — every later request would coalesce onto a buffer nothing replays.
    const rows = await jobStore.listForOrg(ORG);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    expect(pending.rows.size).toBe(0);

    // The key is free — the next request enqueues normally.
    addJob.mockImplementationOnce(async () => {});
    expect(await enqueueOrPendCoalesced(TASK, jobKey, deps, req('c2'))).toBeTruthy();
  });
});

describe('drainCoalesced', () => {
  it('enqueues every pending row and clears them, surviving a bad row', async () => {
    const pending = fakePending();
    await pending.upsert(req('c1'));
    await pending.upsert({ ...req('c9'), repoFullName: 'acme/web' });
    const enqueue = vi.fn(async (r: Req) => {
      if (r.repoFullName === 'acme/web') throw new Error('nope');
      return 'job';
    });

    const drained = await drainCoalesced('scan', pending, (v: Req) => v, enqueue);

    expect(drained).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(pending.rows.size).toBe(0);
  });
});
