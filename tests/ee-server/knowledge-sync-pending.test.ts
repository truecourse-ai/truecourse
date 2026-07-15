import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';

// The sweep/estimate + union processing engines have their own tests; here we
// exercise the Sync/Process flow wiring: the pending-derivation logic and the job
// bodies that persist/clear the pending record. Stub the sync-engine boundary the
// job bodies call so no connector network I/O happens.
vi.mock('../../ee/packages/server/src/knowledge/sync', async (importActual) => {
  const actual = await importActual<typeof import('../../ee/packages/server/src/knowledge/sync')>();
  return { ...actual, syncSource: vi.fn(), processWorkspaceKnowledge: vi.fn() };
});

import { syncSource, processWorkspaceKnowledge } from '../../ee/packages/server/src/knowledge/sync';
import type { WorkspaceSyncEstimate } from '../../ee/packages/server/src/knowledge/sync';
import {
  pendingFromEstimate,
  runKnowledgeEstimate,
  runKnowledgeSync,
  type RunKnowledgeDeps,
} from '../../ee/packages/server/src/jobs/worker';
import { IntegrationStore } from '../../ee/packages/server/src/integrations/store';
import { KNOWLEDGE_ESTIMATE_TASK, KNOWLEDGE_SYNC_TASK, workspaceSyncJobKey } from '../../ee/packages/server/src/jobs/constants';
import { JobStore, NotificationStore, PgKnowledgeStore } from '../../ee/packages/data-store/src/index';

const SECRET = 'master-secret-at-least-32-characters!!';
const ORG = 'org_flow';
const KIND = 'confluence';
const CONFIG = { baseUrl: 'https://acme.atlassian.net', spaceKey: 'ENG', accountEmail: 'u@acme.test' };
const JIRA_CONFIG = { baseUrl: 'https://acme.atlassian.net', projectKey: 'ENG', accountEmail: 'u@acme.test' };

/** A WorkspaceSyncEstimate with a controllable delta + cost. */
function estimate(over: Partial<WorkspaceSyncEstimate>): WorkspaceSyncEstimate {
  return {
    totalEstimatedTokens: 0,
    tiers: [],
    stages: [],
    delta: { new: 0, changed: 0, removed: 0, total: 0 },
    ...over,
  };
}

describe('pendingFromEstimate — pending record + completion toast', () => {
  it('non-empty delta → pending stores the full estimate + a delta-only toast', () => {
    const { pending, notification } = pendingFromEstimate(
      estimate({
        totalEstimatedTokens: 1234,
        stages: [{ stage: 'scan', model: 'claude', calls: 2, estimatedTokens: 1234, estimatedCostUsd: 4.2 }],
        delta: { new: 3, changed: 2, removed: 0, total: 40 },
        subjectLabel: '3 new · 2 changed of 40 docs',
        estimatedCostUsd: 4.2,
        costPartial: true,
      }),
      'Confluence',
      '2026-02-02T00:00:00Z',
    );
    // The full estimate (minus its delta) is persisted so the Process confirm dialog
    // opens from it without re-sweeping.
    expect(pending).toEqual({
      delta: { new: 3, changed: 2, removed: 0, total: 40 },
      estimate: {
        totalEstimatedTokens: 1234,
        tiers: [],
        stages: [{ stage: 'scan', model: 'claude', calls: 2, estimatedTokens: 1234, estimatedCostUsd: 4.2 }],
        subjectLabel: '3 new · 2 changed of 40 docs',
        estimatedCostUsd: 4.2,
        costPartial: true,
      },
      sweptAt: '2026-02-02T00:00:00Z',
    });
    // The toast names only the delta — the cost is confirmed at Process time.
    expect(notification).toMatchObject({ level: 'success', title: 'Sync complete' });
    expect(notification.body).toBe('3 new · 2 changed of 40 docs to process.');
    expect(notification.body).not.toContain('$');
  });

  it('removed-only delta still yields a pending record (pruning must run)', () => {
    const { pending, notification } = pendingFromEstimate(
      estimate({ delta: { new: 0, changed: 0, removed: 2, total: 5 }, subjectLabel: '2 removed of 5 docs' }),
      'Confluence',
      '2026-02-02T00:00:00Z',
    );
    expect(pending).not.toBeNull();
    expect(pending?.delta.removed).toBe(2);
    expect(pending?.estimate.subjectLabel).toBe('2 removed of 5 docs');
    expect(notification.body).toBe('2 removed of 5 docs to process.');
  });

  it('empty delta → null pending + "up to date" toast', () => {
    const { pending, notification } = pendingFromEstimate(
      estimate({ delta: { new: 0, changed: 0, removed: 0, total: 40 }, subjectLabel: '40 docs unchanged' }),
      'Confluence',
      '2026-02-02T00:00:00Z',
    );
    expect(pending).toBeNull();
    expect(notification).toMatchObject({ level: 'success', title: 'Sync complete' });
    expect(notification.body).toBe('Confluence is up to date — nothing to process.');
  });
});

describe('knowledge jobs — pending persist/clear through the harness', () => {
  let client: PGlite;
  let db: EeDb;
  let deps: RunKnowledgeDeps;
  let integrations: IntegrationStore;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema }) as unknown as EeDb;
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    vi.mocked(syncSource).mockReset();
    vi.mocked(processWorkspaceKnowledge).mockReset();
    integrations = new IntegrationStore(db, SECRET);
    await integrations.save(ORG, KIND, { config: CONFIG, token: 'tok-abc' });
    deps = {
      db,
      jobStore: new JobStore(db),
      notifications: new NotificationStore(db),
      integrations,
      knowledge: new PgKnowledgeStore(db),
    };
  });
  afterEach(async () => {
    await client.close();
  });

  it('sweep job with a non-empty delta persists pending + toasts the work to process', async () => {
    vi.mocked(syncSource).mockResolvedValue(
      estimate({
        delta: { new: 3, changed: 2, removed: 0, total: 40 },
        subjectLabel: '3 new · 2 changed of 40 docs',
        estimatedCostUsd: 4.2,
        costPartial: true,
      }),
    );
    const job = await deps.jobStore.create({ org: ORG, type: KNOWLEDGE_ESTIMATE_TASK, key: `${KNOWLEDGE_ESTIMATE_TASK}:${KIND}` });

    await runKnowledgeEstimate(deps, { jobId: job.id, org: ORG, kind: KIND });

    // The sweep result rides the job row; the pending record is workspace-visible.
    expect((await deps.jobStore.get(job.id))?.status).toBe('succeeded');
    const view = await deps.integrations.getView(ORG, KIND);
    expect(view?.pending).toEqual({
      delta: { new: 3, changed: 2, removed: 0, total: 40 },
      estimate: {
        totalEstimatedTokens: 0,
        tiers: [],
        stages: [],
        subjectLabel: '3 new · 2 changed of 40 docs',
        estimatedCostUsd: 4.2,
        costPartial: true,
      },
      sweptAt: expect.any(String),
    });

    const notes = await deps.notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: KNOWLEDGE_ESTIMATE_TASK, level: 'success', title: 'Sync complete' });
    expect(notes[0]?.body).toBe('3 new · 2 changed of 40 docs to process.');
  });

  it('sweep job with an empty delta clears any stored pending + toasts "up to date"', async () => {
    // A stale pending record from a prior sweep.
    await deps.integrations.setPending(ORG, KIND, {
      delta: { new: 1, changed: 0, removed: 0, total: 10 },
      estimate: { totalEstimatedTokens: 0, tiers: [], subjectLabel: '1 new of 10 docs' },
      sweptAt: '2026-01-01T00:00:00Z',
    });
    vi.mocked(syncSource).mockResolvedValue(
      estimate({ delta: { new: 0, changed: 0, removed: 0, total: 10 }, subjectLabel: '10 docs unchanged' }),
    );
    const job = await deps.jobStore.create({ org: ORG, type: KNOWLEDGE_ESTIMATE_TASK, key: `${KNOWLEDGE_ESTIMATE_TASK}:${KIND}` });

    await runKnowledgeEstimate(deps, { jobId: job.id, org: ORG, kind: KIND });

    expect((await deps.integrations.getView(ORG, KIND))?.pending).toBeNull();
    const notes = await deps.notifications.listForOrg(ORG);
    expect(notes[0]?.body).toBe('Confluence is up to date — nothing to process.');
  });

  it('processing job consolidates the UNION and clears EVERY connector’s pending on success', async () => {
    // Two connected sources, each with its own pending record from a prior sweep.
    await integrations.save(ORG, 'jira', { config: JIRA_CONFIG, token: 'tok-jira' });
    for (const kind of ['confluence', 'jira']) {
      await deps.integrations.setPending(ORG, kind, {
        delta: { new: 1, changed: 0, removed: 0, total: 1 },
        estimate: { totalEstimatedTokens: 0, tiers: [], subjectLabel: '1 new of 1 doc' },
        sweptAt: '2026-02-02T00:00:00Z',
      });
    }
    vi.mocked(processWorkspaceKnowledge).mockResolvedValue({
      synced: 40,
      bySource: { confluence: 25, jira: 15 },
    });
    const job = await deps.jobStore.create({
      org: ORG,
      type: KNOWLEDGE_SYNC_TASK,
      key: workspaceSyncJobKey(ORG),
    });

    // A decision-triggered Process passes an empty kind; the union job ignores it.
    await runKnowledgeSync(deps, { jobId: job.id, org: ORG, kind: '' });

    expect((await deps.jobStore.get(job.id))?.status).toBe('succeeded');
    // Process runs the store-backed union once — no per-connector fetch loop.
    expect(processWorkspaceKnowledge).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processWorkspaceKnowledge).mock.calls[0][0]).toBe(ORG);
    // BOTH pendings cleared — each source's swept work was consumed.
    expect((await deps.integrations.getView(ORG, 'confluence'))?.pending).toBeNull();
    expect((await deps.integrations.getView(ORG, 'jira'))?.pending).toBeNull();
    // Completion toasts in the Process stage's own vocabulary, not "sync".
    const notes = await deps.notifications.listForOrg(ORG);
    expect(notes[0]).toMatchObject({ kind: KNOWLEDGE_SYNC_TASK, level: 'success', title: 'Processing complete' });
    expect(notes[0]?.body).toBe('Processed 40 documents.');
  });
});
