/**
 * `context.scan` — the workspace Document scan as a background job, through the
 * real lifecycle envelope (PGlite + `executeJob`), with the scan engine itself
 * behind its seam.
 *
 * What is pinned here is everything AROUND the curation:
 *
 *   - the job posts ONE notification, and says so when conflicts are open;
 *   - the RIPPLE — a repository whose slice moved gets Test setup when it has
 *     never been set up and Test generation when it has, nothing at all when the
 *     corpus did not change, when a conflict is open, or when its own documents
 *     did not move, and a repository already working is simply skipped;
 *   - COALESCING — a trigger that lands while the scan is reading queues exactly
 *     one more run, and one that lands before it does not;
 *   - the CHAIN — a sync that reconciled something starts the scan, and one that
 *     reconciled nothing does not.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore, NotificationStore } from '@truecourse/data-store';
import { executeJob, type JobRuntime } from '@truecourse/jobs';
import type { CuratedCorpus, DecisionsFile } from '@truecourse/spec-consolidator';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import type { WorkspaceContextScanResult } from '@truecourse/core/commands/context-scan';
import {
  createContextScanTask,
  type ContextScanJobPayload,
  type ContextScanJobResult,
  type ContextScanTaskDeps,
} from '../../apps/dashboard/server/src/jobs/tasks/context-scan';
import {
  createContextSyncTask,
  type ContextSyncJobRequest,
  type ContextSyncJobResult,
} from '../../apps/dashboard/server/src/jobs/tasks/context-sync';
import {
  rippleContextScan,
  rippleLinksChanged,
  sliceChanged,
  type RippleRepo,
} from '../../apps/dashboard/server/src/jobs/context-ripple';
import { setContextEventPublisher } from '../../apps/dashboard/server/src/services/context.service';
import { memoryContextStore } from '../helpers/memory-context-store';
import type { WorkspaceLlm } from '../../apps/dashboard/server/src/services/workspace-llm.service';

const ORG = 'org_A';
const SRC_A = 'repo-acme-widgets';
const SRC_B = 'stripe-docs';

let client: PGlite;
let db: Db;
let context: ReturnType<typeof memoryContextStore>;

const testLlm: WorkspaceLlm = {
  mode: 'api',
  driver: () => ({}) as never,
  transport: () => ({}) as never,
} as unknown as WorkspaceLlm;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  context = memoryContextStore();
  setContextStore(context);
  setContextEventPublisher(() => {});
});

afterEach(async () => {
  resetContextStore();
  setContextEventPublisher(null);
  await client.close();
});

function runtime(): JobRuntime & { jobStore: JobStore; notifications: NotificationStore } {
  return {
    db,
    jobStore: new JobStore(db),
    notifications: new NotificationStore(db),
    publish: async () => {},
  };
}

const ref = (sourceId: string, name: string): string => `context/${sourceId}/${name}`;

/** A corpus over the two sources; `extra` adds a document to source A. */
function corpus(opts: { extra?: string; conflict?: boolean } = {}): CuratedCorpus {
  const docs = [
    { ref: ref(SRC_A, 'one.md'), kind: 'prd' as const, lastTouched: '', areaTags: ['p/c'], sourceId: SRC_A },
    { ref: ref(SRC_B, 'site.md'), kind: 'prd' as const, lastTouched: '', areaTags: ['p/c'], sourceId: SRC_B },
    ...(opts.extra
      ? [{ ref: ref(SRC_A, opts.extra), kind: 'prd' as const, lastTouched: '', areaTags: ['p/c'], sourceId: SRC_A }]
      : []),
  ];
  return {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs,
    areas: [
      {
        id: 'p/c',
        product: 'p',
        concern: 'c',
        docRefs: docs.map((d) => d.ref),
        overlaps: opts.conflict
          ? [
              {
                docs: [ref(SRC_A, 'one.md'), ref(SRC_B, 'site.md')],
                note: 'they disagree',
                sections: [],
                areas: ['p/c'],
              },
            ]
          : [],
      },
    ],
    skippedDocs: [],
  };
}

const EMPTY_DECISIONS: DecisionsFile = {
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
};

/** What the scan engine hands back, as the job reads it. */
function scanResult(over: Partial<WorkspaceContextScanResult> = {}): WorkspaceContextScanResult {
  return {
    curate: {} as WorkspaceContextScanResult['curate'],
    corpus: corpus(),
    previousCorpus: null,
    corpusChanged: true,
    decisions: EMPTY_DECISIONS,
    sources: [
      { sourceId: SRC_A, title: 'acme/widgets', documents: 1 },
      { sourceId: SRC_B, title: 'Stripe Docs', documents: 1 },
    ],
    documents: 2,
    sessionsRunDir: '/tmp/run',
    noChanges: false,
    ...over,
  };
}

interface RunOptions {
  deps?: Partial<ContextScanTaskDeps>;
  payload?: Partial<ContextScanJobPayload>;
}

/** The run the stubbed engine opens, which the notification's address names. */
const SCAN_RUN_ID = '2026-09-10T12-00-00Z_scanrun1';

/** Run the scan job once, and hand back the settled row + its notifications. */
async function runScan(result: WorkspaceContextScanResult, opts: RunOptions = {}) {
  const rt = runtime();
  const job = await rt.jobStore.create({ org: ORG, type: 'context.scan', key: 'context.scan' });
  const def = createContextScanTask({
    startLlm: async () => testLlm,
    // The real engine announces its run record before it curates anything; the
    // job's notification carries that id as its address.
    runScan: async (options) => {
      options.onRunStarted?.({ command: 'spec-scan', runId: SCAN_RUN_ID, dir: '' });
      return result;
    },
    now: () => new Date('2026-09-10T12:00:00.000Z'),
    ...opts.deps,
  });
  await executeJob(rt, def, {
    jobId: job.id,
    workspaceOrgId: ORG,
    source: 'manual',
    ...opts.payload,
  }).catch(() => undefined);
  const settled = await rt.jobStore.get(job.id);
  return {
    settled,
    result: settled?.result as ContextScanJobResult | null,
    notifications: await rt.notifications.listForOrg(ORG, { limit: 10 }),
  };
}

// ---------------------------------------------------------------------------
// The job itself
// ---------------------------------------------------------------------------

describe('the context.scan job', () => {
  it('settles with the corpus it wrote, and its started row BECOMES the success row', async () => {
    const { settled, result, notifications } = await runScan(scanResult());

    expect(settled?.status).toBe('succeeded');
    expect(result).toMatchObject({ documents: 2, areas: 1, openConflicts: 0, corpusChanged: true });
    // One row per job: the row the scan posted when it began moved onto how it
    // settled instead of a second row landing beside it.
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ level: 'success', title: 'Documents scanned' });
    // The row's address is still the scan's own conversation.
    expect(notifications[0]!.data).toMatchObject({ runId: SCAN_RUN_ID });
  });

  it('says so when the workspace has an open conflict', async () => {
    const { result, notifications } = await runScan(
      scanResult({ corpus: corpus({ conflict: true }) }),
    );

    expect(result?.openConflicts).toBe(1);
    expect(notifications[0]).toMatchObject({
      level: 'warning',
      title: 'Documents scanned, conflicts to resolve',
    });
    expect(notifications[0]!.data).toMatchObject({ runId: SCAN_RUN_ID });
  });

  it('fails loudly when the scan did, and settles no corpus', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'context.scan', key: 'context.scan' });
    const def = createContextScanTask({
      startLlm: async () => testLlm,
      runScan: async (options) => {
        options.onRunStarted?.({ command: 'spec-scan', runId: SCAN_RUN_ID, dir: '' });
        throw new Error('the workspace store went away');
      },
    });
    await executeJob(rt, def, { jobId: job.id, workspaceOrgId: ORG, source: 'manual' }).catch(
      () => undefined,
    );

    const settled = await rt.jobStore.get(job.id);
    expect(settled).toMatchObject({ status: 'failed', error: 'the workspace store went away' });
    const notes = await rt.notifications.listForOrg(ORG, { limit: 10 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ level: 'error', title: 'Document scan failed' });
    // A run the scan opened before dying is still where the failure is read.
    expect(notes[0]!.data).toMatchObject({ runId: SCAN_RUN_ID });
  });

  it('carries no address when the scan died before a run existed', async () => {
    const rt = runtime();
    const job = await rt.jobStore.create({ org: ORG, type: 'context.scan', key: 'context.scan' });
    const def = createContextScanTask({
      startLlm: async () => testLlm,
      runScan: async () => {
        throw new Error('the workspace store went away');
      },
    });
    await executeJob(rt, def, { jobId: job.id, workspaceOrgId: ORG, source: 'manual' }).catch(
      () => undefined,
    );

    const notes = await rt.notifications.listForOrg(ORG, { limit: 10 });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.data).not.toHaveProperty('runId');
  });
});

// ---------------------------------------------------------------------------
// Coalescing — the workspace's own staleness stamp is the pending buffer.
// ---------------------------------------------------------------------------

describe('coalescing', () => {
  const rescans: ContextScanJobPayload[] = [];

  const deps = (): Partial<ContextScanTaskDeps> => ({
    rescan: async (request) => {
      rescans.push(request as ContextScanJobPayload);
    },
  });

  beforeEach(() => {
    rescans.length = 0;
  });

  it('queues exactly one more run when the context moved while the scan was reading', async () => {
    await runScan(scanResult(), {
      deps: {
        ...deps(),
        // The scan reads at 12:00; the sync lands at 12:05.
        runScan: async () => {
          await context.recordSync(ORG, {
            sourceId: SRC_A,
            at: '2026-09-10T12:05:00.000Z',
            parentAt: null,
            added: 1,
            changed: 0,
            removed: 0,
            unchanged: 0,
          });
          return scanResult();
        },
      },
    });

    expect(rescans).toEqual([{ workspaceOrgId: ORG, source: 'rescan' }]);
  });

  it('queues nothing when the context last moved BEFORE the scan started', async () => {
    await context.recordSync(ORG, {
      sourceId: SRC_A,
      at: '2026-09-10T11:00:00.000Z',
      parentAt: null,
      added: 1,
      changed: 0,
      removed: 0,
      unchanged: 0,
    });

    await runScan(scanResult(), { deps: deps() });

    expect(rescans).toEqual([]);
  });

  it('queues nothing for a scan that failed', async () => {
    await runScan(scanResult(), {
      deps: {
        ...deps(),
        runScan: async () => {
          await context.recordSync(ORG, {
            sourceId: SRC_A,
            at: '2026-09-10T12:05:00.000Z',
            parentAt: null,
            added: 1,
            changed: 0,
            removed: 0,
            unchanged: 0,
          });
          throw new Error('nope');
        },
      },
    });

    expect(rescans).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The ripple
// ---------------------------------------------------------------------------

describe('the ripple', () => {
  interface Ripple {
    setups: string[];
    generates: string[];
    deps: Parameters<typeof rippleContextScan>[0];
  }

  function ripple(
    over: { repos?: RippleRepo[]; setUp?: string[]; busy?: string[]; settingUp?: string[] } = {},
  ): Ripple {
    const setups: string[] = [];
    const generates: string[] = [];
    const busy = new Set(over.busy ?? []);
    const setUp = new Set(over.setUp ?? []);
    const settingUp = new Set(over.settingUp ?? []);
    return {
      setups,
      generates,
      deps: {
        workspaceOrgId: ORG,
        listRepos: async () =>
          over.repos ?? [
            { repoId: 'widgets', repoFullName: 'acme/widgets', sourceIds: [SRC_A] },
            { repoId: 'portal', repoFullName: 'acme/portal', sourceIds: [SRC_B] },
          ],
        hasSetup: async (repoFullName) => setUp.has(repoFullName),
        isSettingUp: async (repoFullName) => settingUp.has(repoFullName),
        startSetup: async (repo) => {
          if (busy.has(repo.repoFullName)) return false;
          setups.push(repo.repoFullName);
          return true;
        },
        startGenerate: async (repo) => {
          if (busy.has(repo.repoFullName)) return false;
          generates.push(repo.repoFullName);
          return true;
        },
      },
    };
  }

  it('starts Test setup for a repository that has never been set up', async () => {
    const r = ripple();
    const started = await rippleContextScan(r.deps, {
      previousCorpus: null,
      corpus: corpus(),
      corpusChanged: true,
      openConflicts: 0,
    });

    expect(r.setups).toEqual(['acme/widgets', 'acme/portal']);
    expect(r.generates).toEqual([]);
    expect(started.map((s) => s.job)).toEqual(['guard-setup', 'guard-setup']);
  });

  it('starts Test generation for a repository that is already set up', async () => {
    const r = ripple({ setUp: ['acme/widgets'] });
    await rippleContextScan(r.deps, {
      previousCorpus: null,
      corpus: corpus(),
      corpusChanged: true,
      openConflicts: 0,
    });

    expect(r.generates).toEqual(['acme/widgets']);
    expect(r.setups).toEqual(['acme/portal']);
  });

  it('starts nothing when the corpus did not change', async () => {
    const r = ripple();
    const started = await rippleContextScan(r.deps, {
      previousCorpus: corpus(),
      corpus: corpus(),
      corpusChanged: false,
      openConflicts: 0,
    });

    expect(started).toEqual([]);
    expect(r.setups).toEqual([]);
  });

  it('starts nothing while a conflict is open', async () => {
    const r = ripple();
    const started = await rippleContextScan(r.deps, {
      previousCorpus: null,
      corpus: corpus({ conflict: true }),
      corpusChanged: true,
      openConflicts: 1,
    });

    expect(started).toEqual([]);
    expect(r.setups).toEqual([]);
  });

  it('leaves a repository whose OWN documents did not move alone', async () => {
    const r = ripple();
    // Only source A grew: the repository that reads B reads the same slice.
    await rippleContextScan(r.deps, {
      previousCorpus: corpus(),
      corpus: corpus({ extra: 'two.md' }),
      corpusChanged: true,
      openConflicts: 0,
    });

    expect(r.setups).toEqual(['acme/widgets']);
  });

  it('skips a repository that is already working — its run reads the stored corpus', async () => {
    const r = ripple({ busy: ['acme/widgets'] });
    const started = await rippleContextScan(r.deps, {
      previousCorpus: null,
      corpus: corpus(),
      corpusChanged: true,
      openConflicts: 0,
    });

    expect(started.map((s) => s.repoFullName)).toEqual(['acme/portal']);
  });

  it('skips a repository with no slice at all — there is nothing to generate against', async () => {
    const r = ripple({ repos: [{ repoId: 'x', repoFullName: 'acme/none', sourceIds: [] }] });
    const started = await rippleContextScan(r.deps, {
      previousCorpus: null,
      corpus: corpus(),
      corpusChanged: true,
      openConflicts: 0,
    });

    expect(started).toEqual([]);
  });

  // A connect starts the repository's setup from the sync's settle hook, before
  // any scan exists. The ripple must not depend on losing that race.
  it('skips a repository whose setup is already queued or running', async () => {
    const r = ripple({ settingUp: ['acme/widgets'] });
    const started = await rippleContextScan(r.deps, {
      previousCorpus: null,
      corpus: corpus(),
      corpusChanged: true,
      openConflicts: 0,
    });

    expect(r.setups).toEqual(['acme/portal']);
    expect(started.map((s) => s.repoFullName)).toEqual(['acme/portal']);
  });

  it('never throws a ripple failure into the settled scan', async () => {
    const started = await rippleContextScan(
      {
        workspaceOrgId: ORG,
        listRepos: async () => {
          throw new Error('the link store is gone');
        },
        hasSetup: async () => false,
        isSettingUp: async () => false,
        startSetup: async () => true,
        startGenerate: async () => true,
      },
      { previousCorpus: null, corpus: corpus(), corpusChanged: true, openConflicts: 0 },
    );
    expect(started).toEqual([]);
  });

  // The ripple runs from the settle hook, once the single-flight key is free —
  // so the repositories it starts are started after the scan's own row settled.
  // A repository's links changing moves its slice with the corpus standing
  // still: the one repository gets the ripple's rule, and no scan.
  describe('for a repository whose links changed', () => {
    const widgets: RippleRepo = { repoId: 'widgets', repoFullName: 'acme/widgets', sourceIds: [SRC_A] };

    it('starts Test generation for a repository that is set up', async () => {
      const r = ripple({ setUp: ['acme/widgets'] });
      const started = await rippleLinksChanged(r.deps, { corpus: corpus(), openConflicts: 0, repo: widgets });

      expect(r.generates).toEqual(['acme/widgets']);
      expect(started).toEqual({ repoFullName: 'acme/widgets', job: 'guard-generate' });
    });

    it('starts Test setup for one that never was', async () => {
      const r = ripple();
      const started = await rippleLinksChanged(r.deps, { corpus: corpus(), openConflicts: 0, repo: widgets });

      expect(r.setups).toEqual(['acme/widgets']);
      expect(started?.job).toBe('guard-setup');
    });

    it('starts nothing while its setup is in flight — a connect just started it', async () => {
      const r = ripple({ settingUp: ['acme/widgets'] });
      const started = await rippleLinksChanged(r.deps, { corpus: corpus(), openConflicts: 0, repo: widgets });

      expect(started).toBeNull();
      expect(r.setups).toEqual([]);
      expect(r.generates).toEqual([]);
    });

    it('starts nothing before the workspace has a corpus, or when the links cut no slice', async () => {
      const r = ripple({ setUp: ['acme/widgets'] });
      expect(await rippleLinksChanged(r.deps, { corpus: null, openConflicts: 0, repo: widgets })).toBeNull();
      expect(
        await rippleLinksChanged(r.deps, { corpus: corpus(), openConflicts: 0, repo: { ...widgets, sourceIds: [] } }),
      ).toBeNull();
      expect(r.generates).toEqual([]);
    });

    it('starts nothing while a conflict is open', async () => {
      const r = ripple({ setUp: ['acme/widgets'] });
      expect(await rippleLinksChanged(r.deps, { corpus: corpus(), openConflicts: 1, repo: widgets })).toBeNull();
      expect(r.generates).toEqual([]);
    });

    it('never throws — the links are saved either way', async () => {
      const r = ripple({ setUp: ['acme/widgets'] });
      r.deps.startGenerate = async () => {
        throw new Error('the queue is gone');
      };
      expect(await rippleLinksChanged(r.deps, { corpus: corpus(), openConflicts: 0, repo: widgets })).toBeNull();
    });
  });

  it('is what the settled job runs', async () => {
    const r = ripple();
    const { settled } = await runScan(scanResult(), { deps: { ripple: () => r.deps } });

    expect(settled?.status).toBe('succeeded');
    expect(r.setups).toEqual(['acme/widgets', 'acme/portal']);
  });

  it('starts nothing from a scan that failed', async () => {
    const r = ripple();
    await runScan(scanResult(), {
      deps: {
        ripple: () => r.deps,
        runScan: async () => {
          throw new Error('nope');
        },
      },
    });

    expect(r.setups).toEqual([]);
  });
});

describe('sliceChanged', () => {
  it('is true when the repository had no slice and now has one', () => {
    expect(sliceChanged(null, corpus(), [SRC_A])).toBe(true);
  });

  it('is false when only another source moved', () => {
    expect(sliceChanged(corpus(), corpus({ extra: 'two.md' }), [SRC_B])).toBe(false);
  });

  it('is true when the repository’s own documents moved', () => {
    expect(sliceChanged(corpus(), corpus({ extra: 'two.md' }), [SRC_A])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The chain: a sync that reconciled something starts the scan.
// ---------------------------------------------------------------------------

describe('a sync chains the document scan', () => {
  async function runSync(
    counts: { added: number; changed: number; removed: number },
    over: { source?: 'add' | 'manual' | 'push'; kind?: 'site' | 'repository' } = {},
  ) {
    const rt = runtime();
    await context.createSource(ORG, {
      id: SRC_A,
      kind: over.kind ?? 'site',
      title: 'Docs',
      config:
        (over.kind ?? 'site') === 'repository'
          ? { repoFullName: 'acme/widgets', include: [], exclude: [], branch: 'main' }
          : { llmsTxtUrl: 'https://docs.example.com/llms.txt' },
    });
    const chained: ContextSyncJobRequest[] = [];
    const setups: ContextSyncJobRequest[] = [];
    const job = await rt.jobStore.create({
      org: ORG,
      type: 'context.sync',
      key: `context.sync:${SRC_A}`,
    });
    const def = createContextSyncTask({
      drivers: () =>
        new Map([
          [
            over.kind ?? 'site',
            {
              kind: (over.kind ?? 'site') as 'site',
              check: async () => ({ title: 'Docs', count: 0, titles: [], skipped: [] }),
              sync: async () => ({
                title: 'Docs',
                documents: [],
                added: Array.from({ length: counts.added }, (_, i) => `a${i}`),
                changed: Array.from({ length: counts.changed }, (_, i) => `c${i}`),
                removed: Array.from({ length: counts.removed }, (_, i) => `r${i}`),
                unchanged: [],
                skipped: [],
              }),
            },
          ],
        ]),
      chainScan: async (request, result: ContextSyncJobResult) => {
        if (result.added + result.changed + result.removed === 0) return;
        chained.push(request);
      },
      // What the mount does: only a repository source, only on `add`, only when
      // the repository has no setup bundle yet.
      chainSetup: async (request) => {
        if (request.source !== 'add' || (over.kind ?? 'site') !== 'repository') return;
        setups.push(request);
      },
    });
    await executeJob(rt, def, {
      jobId: job.id,
      workspaceOrgId: ORG,
      sourceId: SRC_A,
      source: over.source ?? 'add',
    }).catch(() => undefined);
    return { chained, setups };
  }

  it('chains when the sync reconciled something', async () => {
    const { chained } = await runSync({ added: 2, changed: 0, removed: 0 });
    expect(chained).toEqual([
      { jobId: expect.any(String), workspaceOrgId: ORG, sourceId: SRC_A, source: 'add' },
    ]);
  });

  it('chains nothing when the sync changed no document', async () => {
    expect((await runSync({ added: 0, changed: 0, removed: 0 })).chained).toEqual([]);
  });

  // A connected repository always onboards: Test setup is derived from the CODE
  // and needs no documents, so it starts on the first sync whatever it found.
  it('starts the repository’s test setup even when it reconciled nothing', async () => {
    const { chained, setups } = await runSync(
      { added: 0, changed: 0, removed: 0 },
      { kind: 'repository' },
    );
    expect(chained).toEqual([]);
    expect(setups).toHaveLength(1);
  });

  it('starts it on a repository’s first sync that DID find documents too', async () => {
    const { chained, setups } = await runSync(
      { added: 3, changed: 0, removed: 0 },
      { kind: 'repository' },
    );
    expect(chained).toHaveLength(1);
    expect(setups).toHaveLength(1);
  });

  it('starts nothing on a later sync of the same source', async () => {
    const { setups } = await runSync(
      { added: 1, changed: 0, removed: 0 },
      { kind: 'repository', source: 'push' },
    );
    expect(setups).toEqual([]);
  });
});
