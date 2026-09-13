/**
 * ONBOARDING, END TO END, on the real queue: connecting a repository syncs its
 * own documentation, and what follows depends on what that sync found.
 *
 * Two paths are pinned, because they are the two a connected repository can
 * take:
 *
 *   - NO MARKDOWN — the sync reconciles nothing, so no Document scan is chained
 *     (there is nothing new to curate) — and Test setup starts anyway, because
 *     it derives the recipe, the dependencies and the interfaces from the CODE.
 *     That setup chains no generation: a repository that reads no document has
 *     nothing to generate from, and a failed generate on the Agent page would be
 *     a failure at nothing.
 *   - WITH MARKDOWN — the sync reconciles documents, Test setup starts, and the
 *     Document scan follows. Its ripple finds the setup already in flight and
 *     starts it exactly ONCE; that setup chains the generation.
 *
 * The queue is real (PGlite + the harness) and only graphile is faked, so a
 * chain really enqueues and a body really runs. The engines are stubbed: what is
 * under test is the chain, not the curation.
 *
 * ONE database for the whole file (several PGlite WASM heaps alive in one
 * worker crash it), so each test runs in a workspace of its own.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Runner } from 'graphile-worker';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore, NotificationStore, PgGuardStore } from '@truecourse/data-store';
import { registerJob, type JobTask, type StartWorker } from '@truecourse/jobs';
import type { JobView } from '@truecourse/shared';
import {
  resetContextStore,
  setContextBindings,
  setContextStore,
  type ContextStore,
} from '@truecourse/core/lib/context-store';
import {
  resetSpecStore,
  saveWorkspaceSpec,
  setSpecStore,
} from '@truecourse/core/lib/spec-store';
import {
  resetSessionsRootResolver,
  setSessionsRootResolver,
} from '@truecourse/core/lib/sessions-store';
import { resetGuardStore, setGuardStore } from '@truecourse/core/lib/guard-store';
import type { CuratedCorpus, DecisionsFile } from '../../packages/spec-consolidator/src/index.js';
import type {
  ContextDriverDocument,
  ContextSourceDriver,
} from '@truecourse/core/services/context';
import type { WorkspaceContextScanResult } from '@truecourse/core/commands/context-scan';
import { createServerJobs, type JobsMount } from '../../apps/dashboard/server/src/jobs/index';
import {
  resetRegistryStore,
  setRegistryStore,
  type RegistryStore,
} from '@truecourse/core/config/registry';
import { setContextEventPublisher } from '../../apps/dashboard/server/src/services/context.service';
import { setWorkTreeProvider } from '../../apps/dashboard/server/src/services/work-tree.service';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import type { WorkspaceLlm } from '../../apps/dashboard/server/src/services/workspace-llm.service';

/** A repository (and its source) of its own per test — one database serves all. */
let REPO: string;
let SOURCE: string;
const ref = (name: string): string => `context/${SOURCE}/${name}`;

let client: PGlite;
let db: Db;
/** A workspace of its own per test — one database serves them all. */
let ORG: string;
let orgCounter = 0;
let context: ContextStore;
let jobs: JobsMount;
/** Bodies waiting to run, oldest first — the queue this worker is. */
let pending: (() => Promise<void>)[];
/** What a body threw, if anything: a failed chain must be visible, not silent. */
let failures: string[];
/** Every graphile enqueue, in order — what "was it chained" reads. */
let enqueued: string[];
let home: string;

const testLlm = {
  mode: 'api',
  driver: () => ({}) as never,
  transport: () => ({}) as never,
} as unknown as WorkspaceLlm;

const hub = { start: async () => {}, stop: async () => {}, subscribe: () => () => {} };

/**
 * Runs the onboarding chain's bodies inline; `repo.guard-generate` and
 * `repo.guard-run` are enqueued but never run — what they do has its own suite,
 * and here they are the chain's observable end.
 */
const RUN_INLINE = ['context.sync', 'context.scan', 'repo.guard-setup'];

/**
 * One body at a time, in enqueue order — a single worker's behaviour, and the
 * only honest thing to run against one PGlite connection. A body that enqueues
 * another lands it at the back of the queue, exactly as the real chain does.
 */
function fakeWorker(): StartWorker<Record<string, unknown>> {
  return async ({ rt, tasks }) => {
    const handlers = new Map(
      tasks
        .filter((t: JobTask) => RUN_INLINE.includes(t.type))
        .map((t: JobTask) => [t.type, registerJob(rt, t)] as const),
    );
    return {
      addJob: async (name: string, payload: unknown) => {
        enqueued.push(name);
        const handler = handlers.get(name);
        if (!handler) return;
        pending.push(() => handler(payload, {}));
      },
      stop: async () => {},
    } as unknown as Runner;
  };
}

/** Run every queued body, in order, including the ones a body enqueues. */
async function drain(): Promise<void> {
  while (pending.length > 0) {
    const next = pending.shift()!;
    await next().catch((err) => {
      failures.push((err as Error).message);
    });
  }
}

/** A one-commit repository standing in for an ephemeral clone. */
function fakeClone(): string {
  const dir = fs.mkdtempSync(path.join(home, 'tree-'));
  const run = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  run('init', '--initial-branch=main');
  // The suite hides the developer's global config, so identity is per-repo.
  run('config', 'user.name', 'Test');
  run('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), '# widgets\n');
  run('add', '.');
  run('commit', '-m', 'one');
  return dir;
}

const doc = (docPath: string, body: string): ContextDriverDocument => ({
  docId: docPath,
  docPath,
  title: docPath,
  url: null,
  contentHash: `sha-${docPath}`,
  body,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** The repository driver, yielding exactly what the test says its tree holds. */
function repositoryDriver(documents: ContextDriverDocument[]): ContextSourceDriver {
  return {
    kind: 'repository',
    check: async () => ({ title: REPO, count: documents.length, titles: [], skipped: [] }),
    sync: async () => ({
      title: REPO,
      documents,
      added: documents.map((d) => d.docId),
      changed: [],
      removed: [],
      unchanged: [],
      skipped: [],
    }),
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

/** The corpus the stubbed scan produces over the repository's own documents. */
function corpusOf(docPaths: string[]): CuratedCorpus {
  const docs = docPaths.map((name) => ({
    ref: ref(name),
    kind: 'prd' as const,
    lastTouched: '',
    areaTags: ['p/c'],
    sourceId: SOURCE,
    sourceKind: 'repository',
  }));
  return {
    version: 3,
    generatedAt: '2026-02-01T00:00:00.000Z',
    docs,
    areas: [
      { id: 'p/c', product: 'p', concern: 'c', docRefs: docs.map((d) => d.ref), overlaps: [] },
    ],
    skippedDocs: [],
  };
}

/**
 * The mount with every engine stubbed: the source driver yields `documents`,
 * the scan writes the corpus they curate to, setup succeeds (held open when the
 * test asks), and generate never runs — it is observed as an enqueue.
 */
function mount(documents: ContextDriverDocument[]): JobsMount {
  return createServerJobs({
    db,
    connectionString: 'postgres://unused',
    hub,
    startWorker: fakeWorker(),
    contextSync: { drivers: () => new Map([['repository', repositoryDriver(documents)]]) },
    contextScan: {
      startLlm: async () => testLlm,
      runScan: async (): Promise<WorkspaceContextScanResult> => {
        const corpus = corpusOf(documents.map((d) => d.docPath));
        // The real scan stores what it curated; the ripple reads it back.
        await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', corpus);
        return {
          curate: {} as WorkspaceContextScanResult['curate'],
          corpus,
          previousCorpus: null,
          corpusChanged: true,
          decisions: EMPTY_DECISIONS,
          sources: [{ sourceId: SOURCE, title: REPO, documents: documents.length }],
          documents: documents.length,
          sessionsRunDir: '/tmp/run',
          noChanges: false,
        };
      },
    },
    guardSetup: {
      startLlm: async () => testLlm,
      // A setup that settles leaves a recipe behind — which is what makes the
      // repository "already set up" for everything that asks later.
      runSetup: async (repoRoot: string) => {
        fs.mkdirSync(path.join(repoRoot, '.truecourse', 'scenarios'), { recursive: true });
        fs.writeFileSync(
          path.join(repoRoot, '.truecourse', 'scenarios', 'recipe.json'),
          JSON.stringify({ version: 1, kind: 'cli' }),
        );
        return {
          report: { ranAt: '2026-01-01T00:00:00Z', status: 'ok', reason: '', steps: [] },
          reportPath: '',
          sessionsRunDirs: [],
        } as never;
      },
    },
    guardGenerate: { startLlm: async () => testLlm, runGenerate: async () => ({}) as never },
  });
}

beforeAll(async () => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-onboard-home-')));
  setSessionsRootResolver(() => path.join(home, 'sessions'));
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterAll(async () => {
  resetSessionsRootResolver();
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(async () => {
  orgCounter += 1;
  ORG = `org_${orgCounter}`;
  REPO = `acme/widgets-${orgCounter}`;
  SOURCE = `repo-acme-widgets-${orgCounter}`;
  context = memoryContextStore();
  setContextStore(context);
  setSpecStore(memorySpecStore());
  setContextEventPublisher(() => {});
  // A clone the setup job can acquire — a real one-commit repository, because
  // what a job stores is keyed by the commit it ran on.
  setWorkTreeProvider(async () => ({ dir: fakeClone(), dispose: () => {} }));
  pending = [];
  failures = [];
  enqueued = [];
  setGuardStore(new PgGuardStore(db));
  // Connecting created the repository's source and linked it — slice 1's hook.
  await context.createSource(ORG, {
    id: SOURCE,
    kind: 'repository',
    title: REPO,
    config: { repoFullName: REPO, installationId: 11, include: [], exclude: [], branch: 'main' },
  });
  await setContextBindings(ORG, REPO, [SOURCE]);
  // And it is a repository Code knows: only a connected one is set up.
  const entry = { slug: `acme-widgets-${orgCounter}`, name: REPO, path: REPO };
  const registry: RegistryStore = {
    readRegistry: async () => [entry],
    pruneStaleProjects: async () => [],
    getProjectBySlug: async (slug) => (slug === entry.slug ? entry : null),
    getProjectByPath: async (repoPath) => (repoPath === REPO ? entry : null),
    registerProject: async (repoPath, name) => ({ slug: 'stub', name: name ?? repoPath, path: repoPath }),
    unregisterProject: async () => false,
    touchProject: async () => {},
    setLastAnalyzed: async () => {},
  };
  setRegistryStore(registry);
});

afterEach(async () => {
  await drain();
  await jobs?.stop();
  resetRegistryStore();
  resetContextStore();
  resetSpecStore();
  setContextEventPublisher(null);
  setWorkTreeProvider(null);
  resetGuardStore();
});

const jobsOfType = async (type: string): Promise<JobView[]> =>
  (await new JobStore(db).listForOrg(ORG)).filter((j) => j.type === type);

/** What the connect hook does: sync the repository's own source. */
const connect = (): Promise<unknown> =>
  jobs.enqueueContextSync({ workspaceOrgId: ORG, sourceId: SOURCE, source: 'add' });

describe('connecting a repository with no markdown', () => {
  it('reconciles nothing, scans nothing, and still reaches Test setup', async () => {
    jobs = mount([]);
    await jobs.start();

    await connect();
    await drain();

    // Nothing changed, so no scan — and setup ran anyway.
    expect(enqueued).toEqual(['context.sync', 'repo.guard-setup']);
    const [setup] = await jobsOfType('repo.guard-setup');
    expect(setup).toMatchObject({ status: 'succeeded', result: { status: 'ok', documents: 0 } });
  });

  it('chains no generation, and says why on the setup’s own notification', async () => {
    jobs = mount([]);
    await jobs.start();

    await connect();
    await drain();

    expect(enqueued).not.toContain('repo.guard-generate');
    expect(await jobsOfType('repo.guard-generate')).toEqual([]);
    const notes = await new NotificationStore(db).listForOrg(ORG, { limit: 10 });
    const setupNote = notes.find((n) => n.title === 'Flow setup complete');
    expect(setupNote?.body).toContain('No documents linked yet');
    // Nothing failed: a repository that reads nothing has failed at nothing.
    expect(notes.every((n) => n.level !== 'error')).toBe(true);
  });
});

describe('connecting a repository with markdown', () => {
  it('syncs, sets up, scans — and starts each of them exactly once', async () => {
    jobs = mount([doc('docs/one.md', '# One\n'), doc('docs/two.md', '# Two\n')]);
    await jobs.start();

    await connect();
    await drain();

    expect(failures).toEqual([]);
    // Setup first — it waits on nothing — then the scan the documents earned.
    expect(enqueued.slice(0, 3)).toEqual(['context.sync', 'repo.guard-setup', 'context.scan']);
    expect(enqueued.filter((t) => t === 'repo.guard-setup')).toHaveLength(1);
    expect(await jobsOfType('repo.guard-setup')).toHaveLength(1);

    // And the generation starts exactly once, from whichever of the two settled
    // last: the scan's ripple skips a setup still in flight, and a setup that
    // read no document chains nothing — so the two never both start it.
    expect(enqueued.filter((t) => t === 'repo.guard-generate')).toHaveLength(1);
    expect(await jobsOfType('repo.guard-generate')).toHaveLength(1);
  });
});
