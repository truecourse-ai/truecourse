/**
 * The `knowledge.guard` job definition on the shared harness, with the workspace
 * guard pipeline faked (no connectors, no LLM): the fetch → generate step progress,
 * the three success/warning notification variants (scenarios generated · waiting for
 * spec · blocked on conflicts), and failure → onError.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { JobStore, NotificationStore } from '../../ee/packages/data-store/src/index';
import { KNOWLEDGE_GUARD_TASK, workspaceGuardJobKey } from '../../ee/packages/server/src/jobs/constants';
import { runKnowledgeGuard, type WorkspaceGuardPipeline } from '../../ee/packages/server/src/jobs/worker';

const ORG = 'org_ws_guard_job';

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

function payloadFor(jobId: string) {
  return { jobId, org: ORG };
}

describe('runKnowledgeGuard — worker body', () => {
  it('drives fetch → generate progress, succeeds, and notifies with the scenario count', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: KNOWLEDGE_GUARD_TASK, key: workspaceGuardJobKey(ORG) });

    const progressAfter: Array<string | null> = [];
    const pipeline: WorkspaceGuardPipeline = {
      run: vi.fn(async (org, progress) => {
        expect(org).toBe(ORG);
        expect(progress.tracker).toBeDefined();
        for (const phase of ['fetch', 'generate'] as const) {
          await progress.onPhase?.(phase);
          const j = await jobStore.get(job.id);
          if (j) progressAfter.push(j.progress.message);
        }
        return { savedFileCount: 3, scenariosWritten: 2, noCorpus: false, openConflicts: 0 };
      }),
    };

    await runKnowledgeGuard({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    expect(progressAfter).toEqual(['Fetching documents', 'Generating scenarios']);
    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ scenariosWritten: 2, noCorpus: false });

    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: KNOWLEDGE_GUARD_TASK,
      level: 'success',
      title: 'Scenarios generated',
      body: '2 guard scenarios generated.',
    });
  });

  it('singular wording for one scenario', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: KNOWLEDGE_GUARD_TASK, key: workspaceGuardJobKey(ORG) });
    const pipeline: WorkspaceGuardPipeline = {
      run: async () => ({ savedFileCount: 1, scenariosWritten: 1, noCorpus: false, openConflicts: 0 }),
    };
    await runKnowledgeGuard({ db, jobStore, notifications, pipeline }, payloadFor(job.id));
    expect((await notifications.listForOrg(ORG))[0]?.body).toBe('1 guard scenario generated.');
  });

  it('a noCorpus run succeeds with the "waiting for spec" wording', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: KNOWLEDGE_GUARD_TASK, key: workspaceGuardJobKey(ORG) });
    const pipeline: WorkspaceGuardPipeline = {
      run: async () => ({ savedFileCount: 0, scenariosWritten: 0, noCorpus: true, openConflicts: 0 }),
    };
    await runKnowledgeGuard({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    const notes = await notifications.listForOrg(ORG);
    expect(notes[0]?.level).toBe('success');
    expect(notes[0]?.title).toBe('Scenarios — waiting for spec');
  });

  it('a blocked (open-conflicts) generate completes with a WARNING + the conflict count', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: KNOWLEDGE_GUARD_TASK, key: workspaceGuardJobKey(ORG) });
    const pipeline: WorkspaceGuardPipeline = {
      run: async () => ({ savedFileCount: 0, scenariosWritten: 0, noCorpus: false, openConflicts: 2 }),
    };
    await runKnowledgeGuard({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded'); // needs-attention, not a failure
    expect(done?.result).toMatchObject({ openConflicts: 2 });
    const notes = await notifications.listForOrg(ORG);
    expect(notes[0]).toMatchObject({
      level: 'warning',
      title: 'Scenario generation blocked — 2 spec conflicts to resolve',
    });
  });

  it('marks the job failed and notifies when the pipeline throws (no retry)', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: KNOWLEDGE_GUARD_TASK, key: workspaceGuardJobKey(ORG) });
    const pipeline: WorkspaceGuardPipeline = {
      run: async () => {
        throw new Error('LLM upstream 500');
      },
    };
    await expect(
      runKnowledgeGuard({ db, jobStore, notifications, pipeline }, payloadFor(job.id)),
    ).rejects.toThrow('LLM upstream 500');

    const failed = await jobStore.get(job.id);
    expect(failed?.status).toBe('failed');
    const notes = await notifications.listForOrg(ORG);
    expect(notes[0]).toMatchObject({ kind: KNOWLEDGE_GUARD_TASK, level: 'error', title: 'Scenario generation failed' });
  });
});
