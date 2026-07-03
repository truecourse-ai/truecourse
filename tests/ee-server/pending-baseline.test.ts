import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';

// executeJob's side-channels (SSE + Sentry) are irrelevant here — silence them so
// the coalescing chain is what's under test (mirrors job-harness.test.ts).
vi.mock('../../ee/packages/server/src/jobs/events', () => ({
  publishEvent: async () => {},
}));
vi.mock('../../ee/packages/server/src/observability/sentry', () => ({
  captureEeException: () => {},
  upstreamStatusOf: () => undefined,
}));

// Import the data-store from the built package (not src): the coalescing code
// under test does an `instanceof ActiveJobExistsError` against this package's
// export, so the JobStore that throws it must be the same module instance.
import { JobStore, NotificationStore, PendingBaselineStore } from '@truecourse/ee-data-store';
import { executeJob, type JobDefinition } from '../../ee/packages/server/src/jobs/harness';
import {
  enqueueOrPendBaseline,
  replayPendingBaseline,
  drainPendingBaselines,
} from '../../ee/packages/server/src/jobs/pending-baseline';
import {
  REPO_BASELINE_TASK,
  baselineJobKey,
  type BaselineEnqueueRequest,
  type BaselineJobPayload,
} from '../../ee/packages/server/src/jobs/constants';

const ORG = 'org_A';
const REPO = 'acme/api';

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

const req = (commitSha: string, extra: Partial<BaselineEnqueueRequest> = {}): BaselineEnqueueRequest => ({
  repoFullName: REPO,
  installationId: 42,
  defaultBranch: 'main',
  commitSha,
  workspaceOrgId: ORG,
  ...extra,
});

const payloadFor = (jobId: string, commitSha: string): BaselineJobPayload => ({ jobId, ...req(commitSha) });

/** A repo.baseline-shaped definition whose onSettled replays the pending row via a
 *  fake enqueue — the real chain executeJob → onSettled → replayPendingBaseline. */
function baselineDef(
  pending: PendingBaselineStore,
  enqueue: (r: BaselineEnqueueRequest) => Promise<string | null>,
  opts: { fail?: boolean } = {},
): JobDefinition<BaselineJobPayload> {
  return {
    type: REPO_BASELINE_TASK,
    title: 'Scanning repository',
    steps: [{ key: 'clone', label: 'Cloning repository' }],
    org: (p) => p.workspaceOrgId,
    sentry: () => ({ component: 'github-gate', route: 'test' }),
    onSettled: (ctx) => replayPendingBaseline(pending, enqueue, ctx.payload),
    run: async () => {
      if (opts.fail) throw new Error('scan boom');
      return { result: { repoFullName: REPO }, notification: null };
    },
    onError: (err) => ({ level: 'error', title: 'Scan failed', body: err.message }),
  };
}

describe('enqueueOrPendBaseline — coalesce on single-flight loss', () => {
  it('enqueues normally when no scan is in flight', async () => {
    const jobStore = new JobStore(db);
    const pending = new PendingBaselineStore(db);
    const addJob = vi.fn(async () => {});

    const id = await enqueueOrPendBaseline({ jobStore, pendingBaselines: pending, addJob }, req('c1'));

    expect(id).toBeTruthy();
    expect(addJob).toHaveBeenCalledWith(id, expect.objectContaining({ commitSha: 'c1' }), baselineJobKey(REPO));
    expect(await pending.take(REPO)).toBeNull(); // nothing coalesced
  });

  it('a dropped enqueue records the repo pending follow-up — latest commit wins', async () => {
    const jobStore = new JobStore(db);
    const pending = new PendingBaselineStore(db);
    const addJob = vi.fn(async () => {});
    const deps = { jobStore, pendingBaselines: pending, addJob };

    // A scan already holds the repo's single-flight key.
    await jobStore.create({ org: ORG, type: REPO_BASELINE_TASK, key: baselineJobKey(REPO) });

    // Two quick merges land while it runs — both coalesced, neither enqueued.
    expect(await enqueueOrPendBaseline(deps, req('c1'))).toBeNull();
    expect(await enqueueOrPendBaseline(deps, req('c2', { force: true }))).toBeNull();
    expect(addJob).not.toHaveBeenCalled();

    // Only the NEWEST survives, with its flags carried through.
    const row = await pending.take(REPO);
    expect(row).toMatchObject({
      repoFullName: REPO,
      commitSha: 'c2',
      force: true,
      workspaceOrgId: ORG,
      installationId: 42,
      defaultBranch: 'main',
    });
  });
});

describe('replayPendingBaseline — replay when the running scan settles', () => {
  it('terminal SUCCESS replays exactly one follow-up at the pending commit and clears it', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const pending = new PendingBaselineStore(db);
    await pending.upsert(req('c2'));
    const enqueue = vi.fn(async () => 'follow-up-job');

    const job = await jobStore.create({ org: ORG, type: REPO_BASELINE_TASK, key: baselineJobKey(REPO) });
    await executeJob({ db, jobStore, notifications }, baselineDef(pending, enqueue), payloadFor(job.id, 'c1'));

    expect((await jobStore.get(job.id))?.status).toBe('succeeded');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ commitSha: 'c2', repoFullName: REPO }));
    expect(await pending.take(REPO)).toBeNull(); // consumed
  });

  it('terminal FAILURE also replays the pending follow-up, then rethrows', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const pending = new PendingBaselineStore(db);
    await pending.upsert(req('c2'));
    const enqueue = vi.fn(async () => 'follow-up-job');

    const job = await jobStore.create({ org: ORG, type: REPO_BASELINE_TASK, key: baselineJobKey(REPO) });
    await expect(
      executeJob({ db, jobStore, notifications }, baselineDef(pending, enqueue, { fail: true }), payloadFor(job.id, 'c1')),
    ).rejects.toThrow('scan boom');

    expect((await jobStore.get(job.id))?.status).toBe('failed');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ commitSha: 'c2' }));
    expect(await pending.take(REPO)).toBeNull();
  });

  it('a same-commit pending without force is dropped — no follow-up', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const pending = new PendingBaselineStore(db);
    await pending.upsert(req('c1')); // same commit the run just processed, no force
    const enqueue = vi.fn(async () => 'x');

    const job = await jobStore.create({ org: ORG, type: REPO_BASELINE_TASK, key: baselineJobKey(REPO) });
    await executeJob({ db, jobStore, notifications }, baselineDef(pending, enqueue), payloadFor(job.id, 'c1'));

    expect(enqueue).not.toHaveBeenCalled();
    expect(await pending.take(REPO)).toBeNull(); // still consumed (read-and-delete)
  });

  it('a same-commit pending WITH force still replays (post-conflict re-baseline)', async () => {
    const pending = new PendingBaselineStore(db);
    await pending.upsert(req('c1', { force: true }));
    const enqueue = vi.fn(async () => 'x');

    await replayPendingBaseline(pending, enqueue, payloadFor('j', 'c1'));

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ commitSha: 'c1', force: true }));
  });
});

describe('drainPendingBaselines — boot recovery', () => {
  it('enqueues every pending row and clears them', async () => {
    const pending = new PendingBaselineStore(db);
    await pending.upsert(req('c1'));
    await pending.upsert(req('c9', { repoFullName: 'acme/web' }));
    const enqueue = vi.fn(async () => 'x');

    const drained = await drainPendingBaselines(pending, enqueue);

    expect(drained).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(await pending.take(REPO)).toBeNull();
    expect(await pending.take('acme/web')).toBeNull();
  });
});
