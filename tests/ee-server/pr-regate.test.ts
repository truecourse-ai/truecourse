import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import {
  JobStore,
  NotificationStore,
  ActiveJobExistsError,
} from '../../ee/packages/data-store/src/index';
import { PR_REGATE_TASK, prRegateJobKey } from '../../ee/packages/server/src/jobs/constants';
import { runPrRegate } from '../../ee/packages/server/src/jobs/worker';

const ORG = 'org_A';

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

describe('pr.regate — enqueue single-flight (per repo AND PR)', () => {
  it('creates a queued row, dedupes the same PR, and lets distinct PRs/repos through', async () => {
    const store = new JobStore(db);

    const first = await store.create({
      org: ORG,
      type: PR_REGATE_TASK,
      key: prRegateJobKey('acme/api', 7),
    });
    expect(first.status).toBe('queued');
    expect(first.type).toBe(PR_REGATE_TASK);
    expect(first.key).toBe('pr.regate:acme/api#7');

    // Same repo + PR while the first is active → single-flight rejection.
    await expect(
      store.create({ org: ORG, type: PR_REGATE_TASK, key: prRegateJobKey('acme/api', 7) }),
    ).rejects.toBeInstanceOf(ActiveJobExistsError);

    // A DIFFERENT PR of the same repo is independent (may re-gate concurrently).
    const otherPr = await store.create({
      org: ORG,
      type: PR_REGATE_TASK,
      key: prRegateJobKey('acme/api', 8),
    });
    expect(otherPr.id).not.toBe(first.id);

    // A different repo, same PR number, is independent too.
    const otherRepo = await store.create({
      org: ORG,
      type: PR_REGATE_TASK,
      key: prRegateJobKey('acme/web', 7),
    });
    expect(otherRepo.id).not.toBe(first.id);

    // Once the first PR's job goes terminal, its key frees for a fresh re-gate.
    await store.markSucceeded(first.id, { repoFullName: 'acme/api', prNumber: 7 });
    const rerun = await store.create({
      org: ORG,
      type: PR_REGATE_TASK,
      key: prRegateJobKey('acme/api', 7),
    });
    expect(rerun.status).toBe('queued');
  });
});

describe('runPrRegate — worker body', () => {
  it('drives the stepped progress, completes the job, and emits a success notification', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: PR_REGATE_TASK,
      key: prRegateJobKey('acme/api', 7),
    });

    // The re-gate seam drives the gate's coarse phases; capture the job row's
    // progress after each so we can assert the checklist advances over the same
    // store the popup reads.
    const progressAfter: Array<{ current: number; total: number; message: string | null }> = [];
    const regate = vi.fn(
      async (_repo: string, _pr: number, onPhase?: (p: string) => void | Promise<void>) => {
        for (const phase of ['spec', 'contracts', 'verify', 'verdict']) {
          await onPhase?.(phase);
          const j = await jobStore.get(job.id);
          if (j) progressAfter.push({ ...j.progress });
        }
      },
    );

    await runPrRegate(
      { db, jobStore, notifications, regate },
      { jobId: job.id, workspaceOrgId: ORG, repoFullName: 'acme/api', prNumber: 7 },
    );

    // The re-gate is invoked with an onPhase callback (steps flow through it).
    expect(regate).toHaveBeenCalledWith('acme/api', 7, expect.any(Function));

    // Four phases advanced the checklist, in order, over the full step count.
    expect(progressAfter.map((p) => p.message)).toEqual([
      'Re-checking spec',
      'Generating contracts',
      'Verifying against baseline',
      'Posting verdict',
    ]);
    expect(progressAfter.every((p) => p.total === 4)).toBe(true);
    expect(progressAfter.map((p) => p.current)).toEqual([0, 1, 2, 3]);

    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ repoFullName: 'acme/api', prNumber: 7 });

    // Baseline parity: success posts a durable notification (the client toasts it).
    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: PR_REGATE_TASK,
      level: 'success',
      title: 'PR re-gated',
      body: 'acme/api — PR #7 re-gated after conflict resolution.',
    });
  });

  it('marks the job failed and notifies when the re-gate throws (no retry)', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: PR_REGATE_TASK,
      key: prRegateJobKey('acme/api', 7),
    });

    const regate = vi.fn().mockRejectedValue(new Error('gate upstream 500'));
    await expect(
      runPrRegate(
        { db, jobStore, notifications, regate },
        { jobId: job.id, workspaceOrgId: ORG, repoFullName: 'acme/api', prNumber: 7 },
      ),
    ).rejects.toThrow('gate upstream 500'); // propagates so graphile records the permanent fail

    const failed = await jobStore.get(job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('gate upstream 500');

    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: PR_REGATE_TASK,
      level: 'error',
      title: 'PR re-gate failed — acme/api',
    });
    expect(notes[0]?.data).toMatchObject({ detail: 'gate upstream 500', prNumber: 7 });
  });

  it('fails the job when the GitHub App is not configured (null regater)', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: PR_REGATE_TASK,
      key: prRegateJobKey('acme/api', 7),
    });

    await expect(
      runPrRegate(
        { db, jobStore, notifications, regate: null },
        { jobId: job.id, workspaceOrgId: ORG, repoFullName: 'acme/api', prNumber: 7 },
      ),
    ).rejects.toThrow('the GitHub App is not configured');

    expect((await jobStore.get(job.id))?.status).toBe('failed');
    expect((await notifications.listForOrg(ORG))[0]?.level).toBe('error');
  });
});
