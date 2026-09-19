/**
 * Onboarding as a chain of background jobs: `repo.guard-setup` →
 * `repo.guard-generate` → `repo.guard-run`, which the workspace Document scan
 * and its sync start (`tests/dashboard-server/context-*`).
 *
 * What is pinned here is the chain's semantics and the setup job's brackets.
 * The setup job materializes the
 * stored spec and the newest setup BUNDLE into its ephemeral clone, runs the
 * real engine over it, and saves the bundle back under the clone's commit, so
 * a second run replays the settled steps instead of re-deriving them. The
 * generate job brackets its engine the same way — the stored spec, the repo's
 * guard decisions, the baseline scenario set and setup's bundle go into the
 * clone; the scenario tree, the baseline report and the birth evidence come
 * out — and stores nothing from a run that authored nothing. The run job closes
 * the chain: the baseline set, workspace documents and setup's bundle go into
 * the clone; the run snapshot and every scenario's evidence bundle — screenshots as bytes — come
 * out as the repo's baseline run. And a disconnect mid-run cancels quietly: no
 * error, no notification, clone gone.
 *
 * The queue itself is real (PGlite + the real harness); only graphile is faked,
 * so a job body runs inline the moment it is enqueued. The LLM never is: the
 * setup sessions come in through their seams and the driver is scripted.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Runner } from 'graphile-worker';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore, NotificationStore, PgSessionRunStore, PgGuardStore, PgGuardOverlayStore, PgSpecStore } from '@truecourse/data-store';
import { registerJob, type JobTask, type StartWorker } from '@truecourse/jobs';
import type { JobView } from '@truecourse/shared';
// The dist entries the server itself imports — a source-path import here would
// install these seams on a parallel copy of the module.
import {
  setGuardStore,
  loadGuardSetupBundle,
  loadScenarios,
  readGuardBaselineCommit,
  readGuardLatest,
  readGuardResult,
  saveGuardSetupBundle,
  saveScenarios,
  writeGuardDecisions,
  writeGuardResult,
} from '@truecourse/core/lib/guard-store';
import { setGuardOverlayStore, writeGuardOverlays } from '@truecourse/core/lib/guard-overlays';
import { setSpecStore, saveWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import {
  resetContextStore,
  setContextBindings,
  setContextStore,
  writeContextDocuments,
} from '@truecourse/core/lib/context-store';
import { memoryContextStore } from '../helpers/memory-context-store';
import {
  listStoredSessionRuns,
  openStoredSessionRun,
  setSessionRunBackend,
} from '@truecourse/core/lib/sessions-store';
import { guardSetupInProcess } from '@truecourse/core/commands/guard-setup';
import { CreditsExhaustedError } from '@truecourse/core/lib/credits-store';
import { OpenConflictsError } from '@truecourse/core/commands/guard-in-process';
import {
  buildDocSectionIndex,
  runGuard,
  guardDecisionsPath,
  guardWorldDirtyMarkerPath,
  indexRepoDocs,
  manifestPath,
  recipePath,
  resolveBinding,
  scenariosDir,
  writeGuardResult as writeCloneGuardResult,
} from '@truecourse/guard-runner';
import { GUARD_FORMAT_VERSION, type GuardGenerateReport, type GuardLatest } from '@truecourse/shared';
import { createServerJobs, type JobsMount } from '../../apps/dashboard/server/src/jobs/index';
import { captureJobStarted } from '../../apps/dashboard/server/src/observability/posthog';
import type { RepoGuardGenerateTaskDeps } from '../../apps/dashboard/server/src/jobs/tasks/repo-guard-generate';
import type { RepoGuardRunTaskDeps } from '../../apps/dashboard/server/src/jobs/tasks/repo-guard-run';
import { setWorkTreeProvider } from '../../apps/dashboard/server/src/services/work-tree.service';
import {
  removeRepoRunState,
  setRepoJobsCanceller,
} from '../../apps/dashboard/server/src/services/repo-removal.service';
import type { WorkspaceLlm } from '../../apps/dashboard/server/src/services/workspace-llm.service';
import { forbiddenDriver } from '../core/spec-scan-session-stub';

// A claimed job is reported from the queue's started seam; here it is a spy, so
// what the runner observes is asserted and nothing is sent.
vi.mock('../../apps/dashboard/server/src/observability/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../apps/dashboard/server/src/observability/posthog')>()),
  captureJobStarted: vi.fn(),
}));

const ORG = 'org_A';
const REPO = 'acme/widgets';
const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url));

let client: PGlite;
let db: Db;
let jobs: JobsMount;
/** Every job body still running — awaited so nothing leaks between tests. */
let running: Promise<void>[];
/** Every graphile enqueue, in order — what "was it chained" reads. */
let enqueued: string[];
/** The payload each of those enqueues carried, in the same order. */
let enqueuedPayloads: Record<string, unknown>[];
const disposed: string[] = [];
const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  // realpath: macOS /tmp is a symlink, and paths get compared resolved.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

const settle = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await settle(10);
}

/** A provider on a driver nothing in this suite may reach. */
const testLlm: WorkspaceLlm = {
  mode: 'api',
  driver: () => forbiddenDriver('the setup sessions are stubbed in this suite'),
};

/**
 * The runner, with graphile replaced: `addJob` runs the task inline through the
 * real `registerJob` wrapper — which is what puts a running job in the local
 * cancel registry — and does not wait for it, so a test can act while a body is
 * still open. `only` narrows which task types actually have a handler, so a
 * chained enqueue can be observed without its body running.
 */
function fakeWorker(only?: readonly string[]): StartWorker<Record<string, unknown>> {
  return async ({ rt, tasks }) => {
    const handlers = new Map(
      tasks
        .filter((t: JobTask) => !only || only.includes(t.type))
        .map((t: JobTask) => [t.type, registerJob(rt, t)] as const),
    );
    return {
      addJob: async (name: string, payload: unknown) => {
        enqueued.push(name);
        enqueuedPayloads.push(payload as Record<string, unknown>);
        const handler = handlers.get(name);
        if (handler) running.push(handler(payload, {}).catch(() => undefined));
      },
      stop: async () => {},
    } as unknown as Runner;
  };
}

/** The inert event backplane — this suite reads rows, not the live stream. */
const hub = { start: async () => {}, stop: async () => {}, subscribe: () => () => {} };

beforeEach(async () => {
  vi.mocked(captureJobStarted).mockClear();
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setGuardStore(new PgGuardStore(db));
  setGuardOverlayStore(new PgGuardOverlayStore(db, 'master-secret-at-least-32-chars-long!!'));
  setSpecStore(new PgSpecStore(db));
  // One backend, the real one: a run's record and its journal are rows.
  setSessionRunBackend(new PgSessionRunStore(db));
  // Documentation is the WORKSPACE's: the jobs materialize the repository's
  // slice of the workspace corpus, so the workspace store has to exist.
  setContextStore(memoryContextStore());
  running = [];
  enqueued = [];
  enqueuedPayloads = [];
  disposed.length = 0;
});

afterEach(async () => {
  await Promise.all(running);
  resetContextStore();
  setRepoJobsCanceller(null);
  setWorkTreeProvider('github', null);
  await jobs.stop();
  setSessionRunBackend(undefined);
  await client.close();
});

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const request = { repoId: 'widgets', repoFullName: REPO, workspaceOrgId: ORG, source: 'connect' as const };

/** The one Context source the workspace holds in this suite. */
const SOURCE_ID = 'repo-acme-widgets';

/** The ref a scenario binds to: a document is the WORKSPACE's, not the repo's. */
const contextRef = (docPath: string): string => `context/${SOURCE_ID}/${docPath}`;

/** The body every seeded document carries — one markdown section. */
const contextDocBody = (docPath: string): string => `# ${docPath}\n`;

/**
 * The scan's output, as the store holds it now: a workspace corpus over the
 * repository's own Context source, with the documents it names in the context
 * store and the repository linked to that source. This is what a job
 * materializes into its clone.
 */
async function seedWorkspaceSpec(docPaths: string[] = ['docs/orgs.md']): Promise<void> {
  await writeContextDocuments(ORG, SOURCE_ID, {
    documents: docPaths.map((docPath) => ({
      docId: docPath,
      docPath,
      title: docPath,
      url: null,
      contentHash: `sha-${docPath}`,
      updatedAt: '2026-01-01T00:00:00.000Z',
      body: contextDocBody(docPath),
    })),
    removed: [],
  });
  await setContextBindings(ORG, REPO, [SOURCE_ID]);
  await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: docPaths.map((docPath) => ({
      ref: contextRef(docPath),
      kind: 'prd',
      lastTouched: '',
      areaTags: [],
      sourceId: SOURCE_ID,
      sourceKind: 'repository',
    })),
    areas: [],
    skippedDocs: [],
  });
}

const jobsOfType = async (type: string): Promise<JobView[]> =>
  (await new JobStore(db).listForOrg(ORG)).filter((j) => j.type === type);

/** The step checklist a run record mirrors, for a reader with no transcripts. */
const checklistKeys = (run: { display?: { blocks: { kind: string }[] } }): string[] => {
  const block = run.display?.blocks.find((b) => b.kind === 'checklist');
  return ((block as { items: { key: string }[] } | undefined)?.items ?? []).map((i) => i.key);
};

// ---------------------------------------------------------------------------
// The setup job, over a real repository
// ---------------------------------------------------------------------------

describe('the guard setup job', () => {
  let clone: string;
  /** Every setup run's session seams — stubbed; their own suites cover them. */
  const catalogCalls: string[] = [];
  /** Whether the clone held the dependencies overlay when the engine looked. */
  const overlaysSeen: boolean[] = [];
  /** Whether the clone declared its world of unknown state when the engine looked. */
  const worldDirtySeen: boolean[] = [];
  /** Whether the seed seam was told the clone reads as a fresh checkout. */
  const freshCheckoutSeen: boolean[] = [];
  /** Every seed session the engine opened — what a skipped step did not do. */
  const seedCalls: string[] = [];
  let preparationError: string | undefined;
  /** The step whose session meets an empty balance, the way the meter's gate leaves one. */
  let exhaustAt: 'catalog' | 'seed' | null = null;

  /** A fresh clone of the fixture at a stable path, as a run really gets one. */
  function installWorkTree(): void {
    clone = path.join(makeTmpDir('tc-onboarding-clone-'), 'widgets');
    setWorkTreeProvider('github', async () => {
      fs.rmSync(clone, { recursive: true, force: true });
      fs.cpSync(FIXTURE, clone, { recursive: true });
      git(clone, 'init', '--initial-branch=main');
      // The suite hides the developer's global git config, so identity is per-repo.
      git(clone, 'config', 'user.name', 'Test');
      git(clone, 'config', 'user.email', 'test@example.com');
      // As a repository really ignores what the engine writes into it, so the
      // work tree and the corpus the job materializes below are git-ignored.
      fs.writeFileSync(path.join(clone, '.gitignore'), 'node_modules/\n.truecourse/\ncontext/\n');
      git(clone, 'add', '-A');
      git(clone, 'commit', '-m', 'one');
      writeRecipe(clone);
      return {
        dir: clone,
        dispose: () => {
          disposed.push(clone);
          fs.rmSync(clone, { recursive: true, force: true });
        },
      };
    });
  }

  /** A recipe the fixture's dependency-free server really satisfies. */
  function writeRecipe(dir: string): void {
    const recipe = {
      build: 'true',
      api: {
        serve: ['node', path.join(dir, 'server.mjs')],
        healthPath: '/health',
        env: { SEED_STORE: path.join(dir, 'store.json') },
      },
    };
    fs.mkdirSync(path.dirname(recipePath(dir)), { recursive: true });
    fs.writeFileSync(recipePath(dir), JSON.stringify(recipe, null, 2) + '\n');
  }

  beforeEach(async () => {
    catalogCalls.length = 0;
    overlaysSeen.length = 0;
    worldDirtySeen.length = 0;
    freshCheckoutSeen.length = 0;
    seedCalls.length = 0;
    preparationError = undefined;
    exhaustAt = null;
    installWorkTree();
    // Setup reads the curated doc universe, and the job materializes the
    // repository's slice of the workspace corpus into the clone.
    await seedWorkspaceSpec();
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      // Only setup runs: the chained generate is observable as an enqueue.
      startWorker: fakeWorker(['repo.guard-setup']),
      guardSetup: {
        startLlm: async () => testLlm,
        runSetup: (repoRoot, options) =>
          guardSetupInProcess(repoRoot, {
            ...options,
            interfaces: async () => {
              // What the clone carried when the engine looked: the registered
              // instances are materialized as the runner's two overlay files.
              overlaysSeen.push(
                fs.existsSync(path.join(repoRoot, '.truecourse', 'scenarios', 'dependencies.local.json')),
              );
              worldDirtySeen.push(fs.existsSync(guardWorldDirtyMarkerPath(repoRoot)));
              // The real mapping snapshots the derived catalog; the bundle
              // collects that file, so the stub writes it too.
              const snapshot = path.join(repoRoot, '.truecourse', 'guard', 'interfaces.json');
              fs.mkdirSync(path.dirname(snapshot), { recursive: true });
              fs.writeFileSync(
                snapshot,
                JSON.stringify({
                  version: 2,
                  generatedAt: '2026-09-02T00:00:00.000Z',
                  recipeFingerprint: '',
                  interfaces: [],
                }),
              );
              return {
                interfaces: [],
                externalServices: [],
                database: {
                  type: 'sqlite',
                  driver: 'prisma',
                  tables: [{ name: 'Org', columns: [{ name: 'id', type: 'Int', isPrimaryKey: true }] }],
                  relations: [],
                  appImports: [],
                },
                datastoreUrls: [],
              };
            },
            catalogSession: async () => {
              catalogCalls.push(repoRoot);
              if (exhaustAt === 'catalog') throw new CreditsExhaustedError(ORG, 0);
              return { status: 'ok', added: [], findings: [] };
            },
            authorInterfaces: async () => ({ status: 'skipped', reason: 'stubbed in this suite' }),
            seedSession: async (input) => {
              freshCheckoutSeen.push(input.freshCheckout);
              seedCalls.push(repoRoot);
              if (exhaustAt === 'seed') throw new CreditsExhaustedError(ORG, 0);
              return { status: 'skipped', reason: 'stubbed in this suite' };
            },
            preparationSession: async () => preparationError
              ? { status: 'failed', reason: preparationError }
              : { status: 'skipped', reason: 'stubbed in this suite' },
            verifyAuth: async () => ({ status: 'skipped', reason: 'stubbed in this suite' }),
          }),
      },
    });
    await jobs.start();
  });

  it('saves the bundle and records a watchable run', async () => {
    const outcome = await jobs.enqueueGuardSetup(request);
    expect(outcome.status).toBe('queued');
    await Promise.all(running);

    const [setup] = await jobsOfType('repo.guard-setup');
    expect(setup?.error).toBeNull();
    expect(setup).toMatchObject({ status: 'succeeded', result: { status: 'ok' } });

    // The durable half: setup's own state, stored per (repo, commit) — the clone
    // it was written in is already gone.
    const bundle = await loadGuardSetupBundle(REPO);
    expect(Object.keys(bundle ?? {})).toContain('.truecourse/guard/setup.json');
    expect(Object.keys(bundle ?? {})).toContain('.truecourse/scenarios/recipe.json');
    // The interface catalog travels too, so the Interfaces view has something to
    // read in DB mode and the interfaces step can settle on a later commit.
    expect(Object.keys(bundle ?? {})).toContain('.truecourse/guard/interfaces.json');
    expect(disposed).toEqual([clone]);
    expect(fs.existsSync(clone)).toBe(false);

    // The run record lives under the repo IDENTITY (never the throwaway clone),
    // carries the provider it ran on, and mirrors the step checklist.
    const [run] = await listStoredSessionRuns(REPO, 'guard-setup');
    expect(run).toMatchObject({ activityStream: 'ai-sdk-v1', status: 'completed', llm: { mode: 'api', provider: 'test' } });
    expect(checklistKeys(run)).toEqual([
      'clone',
      'recipe',
      'detect',
      'catalog',
      'interfaces',
      'seed',
      'preparations',
      'auth',
    ]);
  }, 60_000);

  it('materializes the registered instances into the clone, and never collects them back', async () => {
    await writeGuardOverlays(REPO, {
      dependencies: { anthropic: { env: { ANTHROPIC_API_KEY: 'sk-test-not-real' } } },
      externals: {},
    });
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    const [setup] = await jobsOfType('repo.guard-setup');
    expect(setup).toMatchObject({ status: 'succeeded' });
    expect(overlaysSeen).toEqual([true]);
    // A secret enters through the dashboard only: the bundle a clone leaves
    // behind carries neither overlay file.
    const bundle = (await loadGuardSetupBundle(REPO)) ?? {};
    expect(Object.keys(bundle)).not.toContain('.truecourse/scenarios/dependencies.local.json');
    expect(Object.keys(bundle)).not.toContain('.truecourse/scenarios/externals.local.json');
    expect(JSON.stringify(bundle)).not.toContain('sk-test-not-real');
  }, 60_000);

  // The compose project is the repository's, so a cancelled or crashed run's
  // volumes are still standing when the next setup boots the world: the clone
  // says so, and the engine wipes before it brings the services up.
  it('declares the shared world of unknown state in every clone', async () => {
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(worldDirtySeen).toEqual([true]);
  }, 60_000);

  // Everything the job writes into the clone before the engine runs — the work
  // tree, the corpus's documents, the setup bundle with its compose file, the
  // two overlay files — is the job's own, so the clone still reads as the fresh
  // checkout it is and the seed's cold-clone proof still has a tree to compare.
  it('leaves the clone reading as a fresh checkout, whatever it materialized', async () => {
    await writeGuardOverlays(REPO, {
      dependencies: { anthropic: { env: { ANTHROPIC_API_KEY: 'sk-test-not-real' } } },
      externals: {},
    });
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(freshCheckoutSeen).toEqual([true]);
  }, 60_000);

  it('replays the settled steps on a second run, from the stored bundle', async () => {
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);
    running = [];

    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    const runs = await jobsOfType('repo.guard-setup');
    expect(runs.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
    // Nothing on disk survived — the second run's clone was made fresh — so a
    // skipped step can only have come from the materialized bundle.
    const bundle = (await loadGuardSetupBundle(REPO)) ?? {};
    const report = JSON.parse(bundle['.truecourse/guard/setup.json'] as string) as {
      steps: { key: string; status: string; reason?: string }[];
    };
    expect(report.steps.find((s) => s.key === 'recipe')).toMatchObject({
      status: 'skipped',
      reason: 'unchanged',
    });
    // The catalog session settled on the first run and never ran again.
    expect(catalogCalls).toHaveLength(1);
  }, 60_000);

  // The money bug: a setup stopped part-way by an empty balance used to throw
  // out of the engine before its bundle was collected, so every step it had
  // already paid for was bought again on the resume.
  it('keeps what it settled when the balance stops it part-way', async () => {
    exhaustAt = 'seed';
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    const [setup] = await jobsOfType('repo.guard-setup');
    expect(setup).toMatchObject({ status: 'paused', pauseReason: 'credits', error: null });
    // The clone is gone, so the spine can only have come out of the bundle.
    expect(fs.existsSync(clone)).toBe(false);
    const bundle = (await loadGuardSetupBundle(REPO)) ?? {};
    const report = JSON.parse(bundle['.truecourse/guard/setup.json'] as string) as {
      steps: { key: string; status: string }[];
    };
    // Everything up to the step the balance stopped, and nothing past it.
    expect(report.steps.map((s) => s.key)).toEqual(['recipe', 'detect', 'catalog', 'interfaces']);
    expect(report.steps.every((s) => s.status !== 'failed')).toBe(true);
    // And the recipe it derived travels too — the expensive half of the step.
    expect(Object.keys(bundle)).toContain('.truecourse/scenarios/recipe.json');
  }, 60_000);

  it('carries the paused setup on as the same job and the same conversation, paying only for the rest', async () => {
    exhaustAt = 'seed';
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);
    running = [];
    const [paused] = await jobs.jobStore.listPaused(ORG);
    expect(paused?.type).toBe('repo.guard-setup');

    exhaustAt = null;
    expect(await jobs.resumePaused(paused!)).toBe(paused!.id);
    await Promise.all(running);

    // ONE job row, carried on rather than started again beside itself.
    const rows = await jobsOfType('repo.guard-setup');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: paused!.id, status: 'succeeded', pauseReason: null });
    // ONE conversation: the record it paused in is the record it finished in.
    const runs = await listStoredSessionRuns(REPO, 'guard-setup');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('completed');
    // The steps the first attempt settled were skipped; the one it was stopped
    // in is the one that ran again.
    expect(catalogCalls).toHaveLength(1);
    expect(seedCalls).toHaveLength(2);
    // And nothing of this workspace is still waiting on a grant.
    expect(await jobs.jobStore.listPaused(ORG)).toEqual([]);
  }, 60_000);

  it('drops the paused row when the same setup is started again by hand', async () => {
    exhaustAt = 'seed';
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);
    running = [];
    expect(await jobs.jobStore.listPaused(ORG)).toHaveLength(1);

    exhaustAt = null;
    await jobs.enqueueGuardSetup({ ...request, source: 'manual' });
    await Promise.all(running);

    // The new job does that work, so the old row is superseded rather than
    // left on the Credits page for a grant to run a second time.
    expect(await jobs.jobStore.listPaused(ORG)).toEqual([]);
    const rows = await jobsOfType('repo.guard-setup');
    expect(rows.map((r) => r.status).sort()).toEqual(['cancelled', 'succeeded']);
  }, 60_000);

  it('chains scenario generation once the recipe gate held', async () => {
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.guard-setup', 'repo.guard-generate']);
    const [generate] = await jobsOfType('repo.guard-generate');
    expect(generate).toMatchObject({ status: 'queued', key: `repo.guard-generate:${REPO}` });
    expect(enqueuedPayloads[1]).toMatchObject({ jobId: generate?.id, repoFullName: REPO, source: 'chain' });
  }, 60_000);

  it('reports the claimed setup once, as the person who asked for it', async () => {
    await jobs.enqueueGuardSetup({ ...request, requestedBy: 'user_1' });
    await Promise.all(running);
    const [setup] = await jobsOfType('repo.guard-setup');

    // Only the setup body runs here; the chained generate never leaves the queue.
    expect(vi.mocked(captureJobStarted)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureJobStarted).mock.calls[0]?.[0]).toMatchObject({
      type: 'repo.guard-setup',
      jobId: setup?.id,
      org: ORG,
      requestedBy: 'user_1',
      meta: { repoFullName: REPO },
    });
  }, 60_000);

  it('names nobody on a setup the queue started itself', async () => {
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(vi.mocked(captureJobStarted)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureJobStarted).mock.calls[0]?.[0]?.requestedBy).toBeUndefined();
  }, 60_000);

  // A connected repository always onboards, documents or not: setup derives its
  // recipe, dependencies and interfaces from the CODE. What it must not do is
  // chain a generate that has no spec to generate from — that generate would
  // fail, and a repository that simply reads nothing has failed at nothing.
  it('is set up, and chains no generation, for a repository that reads no document', async () => {
    await setContextBindings(ORG, REPO, []);

    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.guard-setup']);
    const [setup] = await jobsOfType('repo.guard-setup');
    expect(setup).toMatchObject({ status: 'succeeded', result: { status: 'ok', documents: 0 } });
    expect(setup?.error).toBeNull();
    // One row per job: the started row moved onto how the setup settled.
    const notes = await new NotificationStore(db).listForOrg(ORG, { limit: 10 });
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note).toMatchObject({ level: 'success', title: 'Flow setup complete' });
    expect(note?.body).toContain('No documents linked yet');
    // The row's address: the setup's own conversation.
    const [setupRun] = await listStoredSessionRuns(REPO, 'guard-setup');
    expect(note?.data).toMatchObject({ repoFullName: REPO, runId: setupRun!.runId });
  }, 60_000);

  it('persists a preparation failure, fails the job and Activity, and chains nothing', async () => {
    preparationError = 'Application install failed before private preparation verification (exit 7):\nfixture dependency missing';
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);
    const [job] = await jobsOfType('repo.guard-setup');
    expect(job).toMatchObject({ status: 'failed', error: preparationError });
    expect(enqueued).toEqual(['repo.guard-setup']);
    const bundle = (await loadGuardSetupBundle(REPO))!;
    const report = JSON.parse(bundle['.truecourse/guard/setup.json']);
    expect(report).toMatchObject({ status: 'failed', reason: preparationError });
    expect(report.steps.find((step: { key: string }) => step.key === 'preparations')).toMatchObject({ status: 'failed', reason: preparationError });
    expect(report.steps.some((step: { key: string }) => step.key === 'auth')).toBe(false);
    const [run] = await listStoredSessionRuns(REPO, 'guard-setup');
    expect(run).toMatchObject({ status: 'failed', error: { message: preparationError } });
    const checklist = run.display?.blocks.find(block => block.kind === 'checklist') as { items: { key: string; status: string }[] };
    expect(checklist.items.find(item => item.key === 'preparations')?.status).toBe('error');
    expect(checklist.items.find(item => item.key === 'auth')?.status).toBe('pending');
    expect(disposed).toEqual([clone]);
  }, 60_000);

  it('chains nothing when setup was refused', async () => {
    await jobs.stop();
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      startWorker: fakeWorker(['repo.guard-setup']),
      guardSetup: {
        startLlm: async () => testLlm,
        // A setup whose recipe gate failed must also fail the queued job.
        runSetup: async () =>
          ({
            report: { ranAt: '2026-01-01T00:00:00Z', status: 'failed', reason: 'no recipe', steps: [] },
            reportPath: '',
            sessionsRunDirs: [],
          }) as never,
      },
    });
    await jobs.start();

    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.guard-setup']);
    const [setup] = await jobsOfType('repo.guard-setup');
    expect(setup).toMatchObject({ status: 'failed', error: 'no recipe' });
    expect(await jobsOfType('repo.guard-generate')).toEqual([]);
  });

  it('a refresh consents to replacing the seed — the engine asks, and a hosted refresh is the answer', async () => {
    await jobs.stop();
    const seen: { refresh?: boolean; only?: string; consent?: boolean }[] = [];
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      startWorker: fakeWorker(['repo.guard-setup']),
      guardSetup: {
        startLlm: async () => testLlm,
        runSetup: async (_repoRoot, options) => {
          seen.push({
            refresh: options.refresh,
            only: options.only,
            consent: await options.confirmSeedReplace?.(),
          });
          return {
            report: { ranAt: '2026-01-01T00:00:00Z', status: 'failed', reason: 'no recipe', steps: [] },
            reportPath: '',
            sessionsRunDirs: [],
          } as never;
        },
      },
    });
    await jobs.start();

    await jobs.enqueueGuardSetup({ ...request, only: 'seed', refresh: true });
    await Promise.all(running);
    // Without the flag the engine's own default (no consent) stands.
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(seen).toEqual([
      { refresh: true, only: 'seed', consent: true },
      { refresh: undefined, only: undefined, consent: undefined },
    ]);
  });

  // The recipe names its compose project after this key, and a project's volumes
  // are what `reset` wipes. Two workspaces can be connected to one repository and
  // the heavy-job queue only serializes per workspace, so the WORKSPACE has to be
  // in it or one job's reset reaches the other's live datastore.
  it('hands the engine a compose key that carries the workspace as well as the repository', async () => {
    await jobs.stop();
    const keys: (string | undefined)[] = [];
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      startWorker: fakeWorker(['repo.guard-setup']),
      guardSetup: {
        startLlm: async () => testLlm,
        runSetup: async (_repoRoot, options) => {
          keys.push(options.composeKey);
          return {
            report: { ranAt: '2026-01-01T00:00:00Z', status: 'failed', reason: 'no recipe', steps: [] },
            reportPath: '',
            sessionsRunDirs: [],
          } as never;
        },
      },
    });
    await jobs.start();

    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(keys).toEqual([`${ORG}/${REPO}`]);
  });
});

// ---------------------------------------------------------------------------
// The generate job, over a real repository
// ---------------------------------------------------------------------------

describe('the guard generate job', () => {
  let clone: string;
  let generateLlm: WorkspaceLlm;
  type GenerateEngine = NonNullable<RepoGuardGenerateTaskDeps['runGenerate']>;
  let generateImpl: GenerateEngine;
  /** What the engine found in its clone — the materialization, seen from inside. */
  let seen: { recipe: boolean; decisions: string | null; manifest: boolean; priorReport: boolean }[];

  const RECIPE = { build: 'true', api: { serve: ['node', 'server.mjs'], healthPath: '/health' } };
  const DISMISSED = { doc: 'docs/orgs.md', anchor: 'create', title: 'An org can be created', dismissedAt: '2026-01-01T00:00:00Z' };

  /** A valid report body for `written`, the shape the engine's result is a superset of. */
  const okReport = (written: string[]): Omit<GuardGenerateReport, 'generatedAt'> => ({
    status: 'ok',
    noChanges: false,
    written: written.map((id) => ({
      id,
      title: 'create an org',
      doc: 'docs/orgs.md',
      anchor: 'create',
      file: `.truecourse/scenarios/orgs/${id}.yaml`,
      status: 'passing',
    })),
    birthFindings: [],
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    coverageGaps: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  });

  const okResult = (written: string[]): Awaited<ReturnType<GenerateEngine>> =>
    ({
      guard: { ...okReport(written), flows: { settled: written.length, total: written.length } },
    }) as unknown as Awaited<ReturnType<GenerateEngine>>;

  /** An engine that writes one scenario into the clone and records what it saw. */
  const authoring: GenerateEngine = async (repoRoot) => {
    const dec = guardDecisionsPath(repoRoot);
    seen.push({
      recipe: fs.existsSync(recipePath(repoRoot)),
      decisions: fs.existsSync(dec) ? fs.readFileSync(dec, 'utf-8') : null,
      manifest: fs.existsSync(manifestPath(repoRoot)),
      priorReport: fs.existsSync(path.join(repoRoot, '.truecourse', 'guard', 'result.json')),
    });
    const dir = path.join(scenariosDir(repoRoot), 'orgs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'a1.yaml'),
      [
        'guard: 2',
        'id: a1',
        'title: create an org',
        'binds:',
        '  - doc: docs/orgs.md',
        '    section: create',
        '    fingerprint: "sha256:x"',
        'driver: cli',
        'steps:',
        '  - run: ["--help"]',
        '    expect:',
        '      exit: 0',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      manifestPath(repoRoot),
      JSON.stringify({ version: GUARD_FORMAT_VERSION, flows: [] }, null, 2) + '\n',
    );
    // The report the engine leaves in the tree, with the evidence a finding points at.
    const evidence = '.truecourse/guard/evidence/birth1/a1';
    fs.mkdirSync(path.join(repoRoot, evidence), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, evidence, 'transcript.txt'), 'step 1 failed');
    const report: GuardGenerateReport = {
      ...okReport(['a1']),
      generatedAt: '2026-02-02T00:00:00Z',
      birthFindings: [
        {
          doc: 'docs/orgs.md',
          anchor: 'create',
          scenarioId: 'a1',
          committed: true,
          evidencePath: evidence,
          title: 'An org can be created',
          step: 1,
          expected: 'exit 0',
          actual: 'exit 1',
        },
      ],
    };
    writeCloneGuardResult(repoRoot, report);
    return okResult(['a1']);
  };

  function installWorkTree(): void {
    clone = path.join(makeTmpDir('tc-onboarding-gen-clone-'), 'widgets');
    setWorkTreeProvider('github', async () => {
      fs.rmSync(clone, { recursive: true, force: true });
      fs.cpSync(FIXTURE, clone, { recursive: true });
      git(clone, 'init', '--initial-branch=main');
      git(clone, 'config', 'user.name', 'Test');
      git(clone, 'config', 'user.email', 'test@example.com');
      git(clone, 'add', '-A');
      git(clone, 'commit', '-m', 'one');
      return {
        dir: clone,
        dispose: () => {
          disposed.push(clone);
          fs.rmSync(clone, { recursive: true, force: true });
        },
      };
    });
  }

  beforeEach(async () => {
    seen = [];
    generateLlm = testLlm;
    generateImpl = authoring;
    installWorkTree();
    await seedWorkspaceSpec();
    // Only the generate runs here: the run it chains into is observed as an
    // enqueue, never executed (its clone would race the assertions below).
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      startWorker: fakeWorker(['repo.guard-generate']),
      guardGenerate: {
        startLlm: async () => generateLlm,
        runGenerate: (repoRoot, options) => generateImpl(repoRoot, options),
      },
    });
    await jobs.start();
  });

  /** What setup left: the recipe the generate must load rather than derive. */
  const saveSetupBundle = (): Promise<void> =>
    saveGuardSetupBundle(
      { repoKey: REPO, commitSha: 'setup-commit' },
      { '.truecourse/scenarios/recipe.json': JSON.stringify(RECIPE, null, 2) + '\n' },
    );

  it.each(['api', 'claude-code'] as const)('passes the selected %s driver into generation', async mode => {
    const driver = forbiddenDriver('generation is stubbed in this test');
    let driverConstructions = 0;
    generateLlm = {
      mode,
      driver: () => {
        driverConstructions++;
        return driver;
      },
    };
    let called = false;
    generateImpl = async (repoRoot, options) => {
      called = true;
      expect(options?.driver).toBe(driver);
      expect(options?.transportMode).toBe(mode);
      expect(options?.attribution).toBe(driver.attribution);
      return authoring(repoRoot, options);
    };
    await saveSetupBundle();
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect(called).toBe(true);
    expect(driverConstructions).toBe(1);
    expect((await jobsOfType('repo.guard-generate'))[0]).toMatchObject({ status: 'succeeded' });
  });

  it('refuses a repository that was never set up, and stores nothing', async () => {
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job).toMatchObject({ status: 'failed', error: expect.stringMatching(/guard setup/) });
    expect(seen).toEqual([]);
    expect(await readGuardBaselineCommit(REPO)).toBeNull();
    expect(disposed).toEqual([clone]);
  });

  it('resumes from Postgres history after the original clone and backend instance are gone', async () => {
    const savedTree = path.join(makeTmpDir('tc-resume-input-'), 'tree');
    generateImpl = async (repoRoot, options) => {
      fs.cpSync(repoRoot, savedTree, { recursive: true });
      for (const key of ['index', 'extract', 'interfaces', 'flows', 'match']) options?.tracker?.done(key);
      options?.tracker?.start('author');
      options?.tracker?.start('validate');
      throw new Error('worker interrupted');
    };
    await saveSetupBundle();
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);
    const [source] = await listStoredSessionRuns(REPO, 'guard-generate');
    expect(source.status).toBe('failed');
    expect(fs.existsSync(clone)).toBe(false);

    setWorkTreeProvider('github', async () => {
      fs.cpSync(savedTree, clone, { recursive: true });
      return { dir: clone, dispose: () => fs.rmSync(clone, { recursive: true, force: true }) };
    });
    let resumed = false;
    generateImpl = async (repoRoot, options) => {
      expect(options?.resume).toEqual({
        runId: source.runId, gitRef: source.gitRef,
        completedSteps: ['index', 'extract', 'interfaces', 'flows', 'match'],
      });
      resumed = true;
      return authoring(repoRoot, options);
    };
    await jobs.enqueueGuardGenerate({ ...request, resumeRunId: source.runId });
    await Promise.all(running);
    expect(resumed).toBe(true);
    expect((await jobsOfType('repo.guard-generate')).map(job => job.status).sort()).toEqual(['failed', 'succeeded']);
    expect((await openStoredSessionRun(REPO, 'guard-generate', source.runId)).record().status).toBe('failed');
  });

  it('carries a paused generate on in its own conversation, replaying what it had authored', async () => {
    const savedTree = path.join(makeTmpDir('tc-paused-generate-'), 'tree');
    generateImpl = async (repoRoot, options) => {
      fs.cpSync(repoRoot, savedTree, { recursive: true });
      for (const key of ['index', 'extract', 'interfaces', 'flows', 'match']) options?.tracker?.done(key);
      options?.tracker?.start('author');
      throw new CreditsExhaustedError(ORG, 0);
    };
    await saveSetupBundle();
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);
    running = [];

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job).toMatchObject({ status: 'paused', pauseReason: 'credits', error: null });
    // Nothing partial became the repository's baseline — a half-authored
    // scenario set would be read as the truth about it and diffed against.
    expect(await readGuardBaselineCommit(REPO)).toBeNull();
    const [stopped] = await listStoredSessionRuns(REPO, 'guard-generate');
    expect(stopped?.status).toBe('paused');

    // The grant the resumed run is handed is what it does NOT pay for again.
    setWorkTreeProvider('github', async () => {
      fs.cpSync(savedTree, clone, { recursive: true });
      return { dir: clone, dispose: () => fs.rmSync(clone, { recursive: true, force: true }) };
    });
    generateImpl = async (repoRoot, options) => {
      expect(options?.resume).toEqual({
        runId: stopped!.runId,
        gitRef: stopped!.gitRef,
        completedSteps: ['index', 'extract', 'interfaces', 'flows', 'match'],
      });
      return authoring(repoRoot, options);
    };
    const [paused] = await jobs.jobStore.listPaused(ORG);
    expect(await jobs.resumePaused(paused!)).toBe(job!.id);
    await Promise.all(running);

    // One job row, one conversation, and the scenario set stored at the end.
    expect(await jobsOfType('repo.guard-generate')).toHaveLength(1);
    expect((await jobsOfType('repo.guard-generate'))[0]).toMatchObject({ status: 'succeeded' });
    const runs = await listStoredSessionRuns(REPO, 'guard-generate');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId: stopped!.runId, status: 'completed' });
    expect(await readGuardBaselineCommit(REPO)).not.toBeNull();
    expect(await jobs.jobStore.listPaused(ORG)).toEqual([]);
  });

  it('refuses a resume at a different commit before generation runs', async () => {
    await saveSetupBundle();
    generateImpl = async (_root, options) => {
      options?.sessionRun?.setGitRef?.('a'.repeat(40));
      throw new Error('interrupted');
    };
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);
    const [source] = await listStoredSessionRuns(REPO, 'guard-generate');
    let calls = 0;
    generateImpl = async (...args) => { calls++; return authoring(...args); };
    await jobs.enqueueGuardGenerate({ ...request, resumeRunId: source.runId });
    await Promise.all(running);
    expect(calls).toBe(0);
    expect((await jobsOfType('repo.guard-generate')).some(job => job.error?.includes('commit has changed'))).toBe(true);
  });

  it('materializes and persists generated results', async () => {
    await saveSetupBundle();
    await writeGuardDecisions(REPO, { dismissedClaims: [DISMISSED], dismissedFlows: [] });

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job?.error).toBeNull();
    expect(job).toMatchObject({ status: 'succeeded', result: { status: 'ok', written: 1, birthFindings: 1 } });
    // The engine ran over setup's recipe and the store's dismissals — the first
    // generate has no prior set to replay.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ recipe: true, manifest: false, priorReport: false });
    expect(JSON.parse(seen[0]!.decisions ?? '{}')).toMatchObject({ dismissedClaims: [DISMISSED] });

    // The durable half, keyed by the clone's commit and flagged as the baseline.
    const baseline = await readGuardBaselineCommit(REPO);
    expect(baseline).toMatch(/^[0-9a-f]{40}$/);
    const { scenarios } = await loadScenarios({ repoKey: REPO, commitSha: baseline! });
    expect(scenarios.map((s) => s.id)).toEqual(['a1']);
    expect(await readGuardResult(REPO, baseline!)).toMatchObject({ status: 'ok', generatedAt: '2026-02-02T00:00:00Z' });
    const evidence = await new PgGuardStore(db).readGuardEvidenceAt(
      REPO,
      '.truecourse/guard/evidence/birth1/a1',
      'transcript.txt',
    );
    expect(evidence).toBe('step 1 failed');
    const notes = await new NotificationStore(db).listForOrg(ORG);
    expect(notes.map((n) => [n.level, n.title])).toEqual([
      ['warning', 'Flows generated, findings to review'],
    ]);
    // The row's address: the generate's own conversation.
    const [generateRun] = await listStoredSessionRuns(REPO, 'guard-generate');
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, runId: generateRun!.runId });
    expect(fs.existsSync(clone)).toBe(false);
  }, 60_000);

  it('chains the baseline run once the scenario set is stored', async () => {
    await saveSetupBundle();

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.guard-generate', 'repo.guard-run']);
    expect(enqueuedPayloads[1]).toMatchObject({ repoFullName: REPO, workspaceOrgId: ORG, source: 'chain' });
  });

  // A seed that crashed refuses every flow: the engine still ends `ok`, the
  // report carries the refusal and NOTHING is authored. Chaining the baseline
  // run on that hands it an empty scenario set to fail on seconds later, which
  // reads as two failures for one cause and buries the reason.
  it('settles a warning and chains nothing when the generate authored no scenario', async () => {
    await saveSetupBundle();
    const refusal = {
      status: 'seed-failed',
      message: 'the seed script exited 1\nECONNREFUSED 127.0.0.1:5432',
      flowIds: [],
    };
    generateImpl = async (repoRoot) => {
      writeCloneGuardResult(repoRoot, {
        ...okReport([]),
        generatedAt: '2026-02-02T00:00:00Z',
        refusal,
      });
      return okResult([]);
    };

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job).toMatchObject({ status: 'succeeded', result: { status: 'nothing-written', written: 0 } });
    // The chain ends here — the run is never enqueued.
    expect(enqueued).toEqual(['repo.guard-generate']);
    const notes = await new NotificationStore(db).listForOrg(ORG);
    expect(notes.map((n) => [n.level, n.title])).toEqual([['warning', 'Flows generated nothing']]);
    // The reason the report latched, first line only.
    expect(notes[0]).toMatchObject({ body: 'the seed script exited 1' });
    const [run] = await listStoredSessionRuns(REPO, 'guard-generate');
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, runId: run!.runId });
    // The report is still the record of WHY, so the guard surfaces can say it.
    const baseline = await readGuardBaselineCommit(REPO);
    expect(await readGuardResult(REPO, baseline!)).toMatchObject({ refusal });
  }, 60_000);

  // A generate that found nothing CHANGED over an empty set is still an empty
  // set: the first generate refused every flow and stored a manifest with no
  // scenario, and the re-run found every flow unchanged. `noChanges` says
  // nothing about whether there is anything to run.
  it('settles a warning and chains nothing when an unchanged generate stands over an empty set', async () => {
    await saveSetupBundle();
    const prior = makeTmpDir('tc-onboarding-gen-empty-');
    fs.mkdirSync(scenariosDir(prior), { recursive: true });
    const priorRef = { repoKey: REPO, commitSha: 'prior-commit' };
    await saveScenarios(priorRef, scenariosDir(prior));
    const refusal = { status: 'seed-failed', message: 'the seed script exited 1', flowIds: [] };
    await writeGuardResult(priorRef, { ...okReport([]), generatedAt: '2026-01-01T00:00:00Z', refusal }, { baseline: true });

    generateImpl = async (repoRoot) => {
      writeCloneGuardResult(repoRoot, {
        ...okReport([]),
        generatedAt: '2026-03-03T00:00:00Z',
        noChanges: true,
        refusal,
      });
      return okResult([]);
    };
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect((await jobsOfType('repo.guard-generate'))[0]).toMatchObject({
      status: 'succeeded',
      result: { status: 'nothing-written', written: 0, noChanges: true },
    });
    expect(enqueued).toEqual(['repo.guard-generate']);
  }, 60_000);

  // The clone is fresh but the compose project it boots is the repository's,
  // shared with every earlier job — and the marker that records a mutated
  // world died with the clone that wrote it. So the job declares the world
  // dirty before the engine boots it, and the boot resets first.
  it('marks the shared world dirty in the clone before the engine runs', async () => {
    await saveSetupBundle();
    let marker: string | null = null;
    generateImpl = async (repoRoot, options) => {
      marker = fs.existsSync(guardWorldDirtyMarkerPath(repoRoot))
        ? fs.readFileSync(guardWorldDirtyMarkerPath(repoRoot), 'utf-8')
        : null;
      return authoring(repoRoot, options);
    };
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect(marker).toMatch(/materialized/);
  }, 60_000);

  // The same empty generate over a set that already exists is NOT the same
  // thing: the run has the stored scenarios to work with, and the code under
  // them may have moved since.
  it('still chains the baseline run when a stored scenario set stands behind an empty generate', async () => {
    await saveSetupBundle();
    // What an earlier generate left, materialized into this run's clone before
    // the engine is called.
    const prior = makeTmpDir('tc-onboarding-gen-prior-');
    const orgs = path.join(scenariosDir(prior), 'orgs');
    fs.mkdirSync(orgs, { recursive: true });
    fs.writeFileSync(
      path.join(orgs, 'a1.yaml'),
      [
        'id: a1',
        'title: create an org',
        'binds:',
        '  - doc: docs/orgs.md',
        '    section: create',
        '    fingerprint: "sha256:x"',
        'steps:',
        '  - run: ["--help"]',
        '    expect:',
        '      exit: 0',
        '',
      ].join('\n'),
    );
    const priorRef = { repoKey: REPO, commitSha: 'prior-commit' };
    await saveScenarios(priorRef, scenariosDir(prior));
    await writeGuardResult(priorRef, { ...okReport(['a1']), generatedAt: '2026-01-01T00:00:00Z' }, { baseline: true });

    generateImpl = async (repoRoot) => {
      writeCloneGuardResult(repoRoot, {
        ...okReport([]),
        generatedAt: '2026-03-03T00:00:00Z',
        refusal: { status: 'seed-failed', message: 'the seed script exited 1', flowIds: [] },
      });
      return okResult([]);
    };
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect((await jobsOfType('repo.guard-generate'))[0]).toMatchObject({
      status: 'succeeded',
      result: { status: 'ok', written: 0 },
    });
    expect(enqueued).toEqual(['repo.guard-generate', 'repo.guard-run']);
  }, 60_000);

  // A stored set of files the loader REJECTS is no set at all: the run would
  // load zero scenarios and die on "no scenarios". Counting yaml files would
  // call that a set and chain the run anyway.
  it('chains nothing when the only stored scenarios are malformed', async () => {
    await saveSetupBundle();
    const prior = makeTmpDir('tc-onboarding-gen-malformed-');
    const orgs = path.join(scenariosDir(prior), 'orgs');
    fs.mkdirSync(orgs, { recursive: true });
    fs.writeFileSync(path.join(orgs, 'a1.yaml'), 'guard: 2\nid: a1\n');
    const priorRef = { repoKey: REPO, commitSha: 'prior-commit' };
    await saveScenarios(priorRef, scenariosDir(prior));
    await writeGuardResult(priorRef, { ...okReport(['a1']), generatedAt: '2026-01-01T00:00:00Z' }, { baseline: true });

    generateImpl = async (repoRoot) => {
      writeCloneGuardResult(repoRoot, { ...okReport([]), generatedAt: '2026-03-03T00:00:00Z' });
      return okResult([]);
    };
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect((await jobsOfType('repo.guard-generate'))[0]).toMatchObject({
      status: 'succeeded',
      result: { status: 'nothing-written', written: 0 },
    });
    expect(enqueued).toEqual(['repo.guard-generate']);
  }, 60_000);

  it('saves partial extraction results but fails the job and Activity without chaining', async () => {
    await saveSetupBundle();
    const extractionFailures = [{ doc: 'docs/app.md', reason: 'outcome failed schema: invalid web verification method' }];
    generateImpl = async (repoRoot, options) => {
      const result = await authoring(repoRoot, options);
      writeCloneGuardResult(repoRoot, {
        ...okReport(['a1']), generatedAt: '2026-02-02T00:00:00Z', extractionFailures,
      });
      return result;
    };

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job).toMatchObject({ status: 'failed', error: expect.stringContaining('Claim extraction failed for docs/app.md') });
    expect(job.error).toContain('Partial results were saved');
    const baseline = await readGuardBaselineCommit(REPO);
    expect(baseline).toMatch(/^[0-9a-f]{40}$/);
    expect(await readGuardResult(REPO, baseline!)).toMatchObject({ extractionFailures });
    expect((await loadScenarios({ repoKey: REPO, commitSha: baseline! })).scenarios.map(s => s.id)).toEqual(['a1']);
    const [run] = await listStoredSessionRuns(REPO, 'guard-generate');
    expect(run).toMatchObject({
      status: 'failed', error: { message: job.error },
      display: { blocks: expect.arrayContaining([expect.objectContaining({
        kind: 'checklist', items: expect.arrayContaining([expect.objectContaining({ key: 'extract', status: 'error' })]),
      })]) },
    });
    const opened = await openStoredSessionRun(REPO, 'guard-generate', run.runId);
    expect(opened?.record()).toMatchObject({ status: 'failed', error: { message: job.error } });
    const notes = await new NotificationStore(db).listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ level: 'error', title: 'Flow generation failed', body: expect.stringContaining('docs/app.md') });
    // The moved row keeps what the started row addressed.
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, runId: run.runId });
    expect(enqueued).toEqual(['repo.guard-generate']);
    expect(disposed).toEqual([clone]);
  }, 60_000);

  it('chains nothing when the corpus was blocked, and says why', async () => {
    await saveSetupBundle();
    generateImpl = async () => {
      throw new OpenConflictsError([
        { area: 'orgs', a: 'docs/v1.md', b: 'docs/v2.md', note: 'two names for one thing' },
      ] as never);
    };

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.guard-generate']);
  });

  it('replays the baseline set and report into the next run’s clone', async () => {
    await saveSetupBundle();
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);
    running = [];

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect((await jobsOfType('repo.guard-generate')).map((j) => j.status)).toEqual(['succeeded', 'succeeded']);
    // Nothing on disk survived the first clone — the manifest, the yaml and the
    // report the second engine found came out of the store.
    expect(seen[1]).toMatchObject({ recipe: true, manifest: true, priorReport: true });
  }, 60_000);

  it('stores the blocked report and settles as a warning when the corpus has open conflicts', async () => {
    await saveSetupBundle();
    generateImpl = async () => {
      throw new OpenConflictsError([
        { area: 'orgs', a: 'docs/v1.md', b: 'docs/v2.md', note: 'two names for one thing' },
      ] as never);
    };

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job).toMatchObject({ status: 'succeeded', result: { status: 'open-conflicts', openConflicts: 1 } });
    const baseline = await readGuardBaselineCommit(REPO);
    expect(await readGuardResult(REPO, baseline!)).toMatchObject({
      status: 'open-conflicts',
      reason: expect.stringContaining('docs/v1.md'),
    });
    expect((await loadScenarios({ repoKey: REPO, commitSha: baseline! })).scenarios).toEqual([]);
    const notes = await new NotificationStore(db).listForOrg(ORG);
    expect(notes[0]).toMatchObject({ level: 'warning', title: 'Flow generation blocked' });
  });

  it('a generate that authored nothing fails with its reason and stores nothing', async () => {
    await saveSetupBundle();
    generateImpl = async () =>
      ({ guard: { status: 'llm-failed', reason: 'every extract call failed', written: [], birthFindings: [] } }) as never;

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job).toMatchObject({ status: 'failed', error: 'every extract call failed' });
    expect(await readGuardBaselineCommit(REPO)).toBeNull();
  });

  it('keeps Postgres activity running until results save and records a persistence failure', async () => {
    await saveSetupBundle();
    let checked = false;
    class FailingResults extends PgGuardStore {
      override async writeGuardResult(): Promise<void> {
        const [run] = await listStoredSessionRuns(REPO, 'guard-generate');
        expect(run.status).toBe('running');
        checked = true;
        throw new Error('result persistence failed');
      }
    }
    setGuardStore(new FailingResults(db));
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);
    expect(checked).toBe(true);
    const [run] = await listStoredSessionRuns(REPO, 'guard-generate');
    expect(run).toMatchObject({ status: 'failed', error: { message: 'result persistence failed' } });
    const opened = await openStoredSessionRun(REPO, 'guard-generate', run.runId);
    const events = await opened.readActivity!(-1);
    expect(events.some(e => e.kind === 'run' && e.run.status === 'completed')).toBe(false);
  });

  it('a cancelled generate leaves the store exactly as it found it', async () => {
    await saveSetupBundle();
    let reached = false;
    generateImpl = (_repoRoot, options = {}) =>
      new Promise((_resolve, reject) => {
        reached = true;
        const stop = (): void => reject(new Error('guard generate was cancelled'));
        if (options.signal?.aborted) stop();
        else options.signal?.addEventListener('abort', stop, { once: true });
      });

    const outcome = await jobs.enqueueGuardGenerate(request);
    await until(() => reached);
    if (outcome.status !== 'queued') throw new Error('the generate was not queued');
    expect(await jobs.cancel(outcome.jobId)).toBe('cancelled');
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job).toMatchObject({ status: 'cancelled', error: null });
    expect(await readGuardBaselineCommit(REPO)).toBeNull();
    // The started row stands — the run did start; the stop itself settles quietly.
    expect((await new NotificationStore(db).listForOrg(ORG)).map((n) => n.level)).toEqual(['started']);
    expect(disposed).toEqual([clone]);
  });
});

// ---------------------------------------------------------------------------
// The run job
// ---------------------------------------------------------------------------

describe('the guard run job', () => {
  let clone: string;
  type RunEngine = NonNullable<RepoGuardRunTaskDeps['runGuard']>;
  let runImpl: RunEngine;
  /** What the runner found in its clone — the materialization, seen from inside. */
  let seen: { recipe: boolean; scenario: boolean }[];

  const RECIPE = { build: 'true', api: { serve: ['node', 'server.mjs'], healthPath: '/health' } };
  const GEN_COMMIT = 'gen-commit';
  const RUN_ID = '2026-03-03T00-00-00Z_run1';
  /** The bytes a browser run leaves: not text, and not valid UTF-8 either. */
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);

  const okReport = (): GuardGenerateReport => ({
    generatedAt: '2026-02-02T00:00:00Z',
    status: 'ok',
    noChanges: false,
    written: [
      {
        id: 'a1',
        title: 'create an org',
        doc: 'docs/orgs.md',
        anchor: 'create',
        file: '.truecourse/scenarios/orgs/a1.yaml',
        status: 'passing',
      },
    ],
    birthFindings: [],
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    coverageGaps: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  });

  /** The snapshot a run leaves: one scenario, failed, with an evidence bundle. */
  const latestOf = (evidencePath: string): GuardLatest => ({
    run: { runId: RUN_ID, ranAt: '2026-03-03T00:00:00Z', branch: 'main', commit: null, recipeFingerprint: 'sha256:r' },
    summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 },
    scenarios: [
      {
        id: 'a1',
        title: 'create an org',
        binds: { doc: 'docs/orgs.md', section: 'create', fingerprint: 'sha256:x' },
        outcome: 'fail',
        durationMs: 12,
        failure: { step: 1, expected: 'exit 0', actual: 'exit 1' },
        evidencePath,
      },
    ],
    sections: [],
  });

  /** A runner that records what it saw, leaves an evidence bundle, and reports one red. */
  const failingRun: RunEngine = async (repoRoot) => {
    seen.push({
      recipe: fs.existsSync(recipePath(repoRoot)),
      scenario: fs.existsSync(path.join(scenariosDir(repoRoot), 'orgs', 'a1.yaml')),
    });
    const evidencePath = `.truecourse/guard/evidence/${RUN_ID}/a1`;
    fs.mkdirSync(path.join(repoRoot, evidencePath), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, evidencePath, 'transcript.txt'), 'step 1 failed');
    fs.writeFileSync(path.join(repoRoot, evidencePath, 'step-1.png'), PNG);
    return { status: 'ok', latest: latestOf(evidencePath), loadErrors: [] } as unknown as Awaited<
      ReturnType<RunEngine>
    >;
  };

  function installWorkTree(): void {
    clone = path.join(makeTmpDir('tc-onboarding-run-clone-'), 'widgets');
    setWorkTreeProvider('github', async () => {
      fs.rmSync(clone, { recursive: true, force: true });
      fs.cpSync(FIXTURE, clone, { recursive: true });
      git(clone, 'init', '--initial-branch=main');
      git(clone, 'config', 'user.name', 'Test');
      git(clone, 'config', 'user.email', 'test@example.com');
      git(clone, 'add', '-A');
      git(clone, 'commit', '-m', 'one');
      return {
        dir: clone,
        dispose: () => {
          disposed.push(clone);
          fs.rmSync(clone, { recursive: true, force: true });
        },
      };
    });
  }

  /** The bind a stored scenario carries — the default is inert; the binding
   *  tests pass the document they seeded and the section it really holds. */
  interface StoredBind {
    doc: string;
    section: string;
    fingerprint: string;
  }
  const DEFAULT_BIND: StoredBind = { doc: 'docs/orgs.md', section: 'create', fingerprint: 'sha256:x' };

  /** What generate left: a stored scenario set and its baseline report. */
  async function storeGeneratedSet(bind: StoredBind = DEFAULT_BIND): Promise<void> {
    const dir = makeTmpDir('tc-onboarding-run-set-');
    const orgs = path.join(scenariosDir(dir), 'orgs');
    fs.mkdirSync(orgs, { recursive: true });
    fs.writeFileSync(
      path.join(orgs, 'a1.yaml'),
      ['id: a1', 'title: create an org', 'binds:', `  - doc: ${bind.doc}`, `    section: ${bind.section}`, `    fingerprint: "${bind.fingerprint}"`, 'steps:', '  - run: ["--help"]', '    expect:', '      exit: 0', ''].join('\n'),
    );
    fs.writeFileSync(manifestPath(dir), JSON.stringify({ version: GUARD_FORMAT_VERSION, flows: [] }, null, 2) + '\n');
    const ref = { repoKey: REPO, commitSha: GEN_COMMIT };
    await saveScenarios(ref, scenariosDir(dir));
    await writeGuardResult(ref, okReport(), { baseline: true });
  }

  const saveSetupBundle = (): Promise<void> =>
    saveGuardSetupBundle(
      { repoKey: REPO, commitSha: 'setup-commit' },
      { '.truecourse/scenarios/recipe.json': JSON.stringify(RECIPE, null, 2) + '\n' },
    );

  beforeEach(async () => {
    seen = [];
    runImpl = failingRun;
    installWorkTree();
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      startWorker: fakeWorker(),
      guardRun: {
        startLlm: async () => testLlm,
        runGuard: (repoRoot, options) => runImpl(repoRoot, options),
      },
    });
    await jobs.start();
  });

  it('refuses a repository with no generated scenarios, and stores nothing', async () => {
    await saveSetupBundle();
    await jobs.enqueueGuardRun(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-run');
    expect(job).toMatchObject({ status: 'failed', error: expect.stringMatching(/guard generate/) });
    expect(seen).toEqual([]);
    expect(await readGuardLatest(REPO)).toBeNull();
    expect(disposed).toEqual([clone]);
  });

  it('runs the stored set over setup’s recipe, then saves the baseline run and its evidence', async () => {
    await storeGeneratedSet();
    await saveSetupBundle();

    await jobs.enqueueGuardRun(request);
    await Promise.all(running);
    expect(await listStoredSessionRuns(REPO)).toEqual([]);

    const [job] = await jobsOfType('repo.guard-run');
    expect(job?.error).toBeNull();
    expect(job).toMatchObject({
      status: 'succeeded',
      result: { runId: RUN_ID, summary: { total: 1, fail: 1 } },
    });
    // The runner found both halves in its clone: the stored set and setup's recipe.
    expect(seen).toEqual([{ recipe: true, scenario: true }]);

    // The durable half: the run is the repo's baseline, and the bundle came with it.
    const latest = await readGuardLatest(REPO);
    expect(latest?.run.runId).toBe(RUN_ID);
    // The stored record says where it ran.
    expect(latest?.run.origin).toBe('hosted');
    expect(latest?.scenarios.map((s) => s.outcome)).toEqual(['fail']);
    const store = new PgGuardStore(db);
    const dir = `.truecourse/guard/evidence/${RUN_ID}/a1`;
    expect(await store.readGuardEvidenceAt(REPO, dir, 'transcript.txt')).toBe('step 1 failed');
    expect(await store.listGuardEvidenceAt(REPO, dir)).toEqual(['step-1.png', 'transcript.txt']);
    // The screenshot survived byte-exact — it never went through a text decode.
    expect(await store.readGuardEvidenceBytesAt(REPO, dir, 'step-1.png')).toEqual(PNG);

    const notes = await new NotificationStore(db).listForOrg(ORG);
    expect(notes.map((n) => [n.level, n.title])).toEqual([
      ['warning', 'Flows ran, failures to review'],
    ]);
    // The row's address: the repository's own page for THIS run.
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, guardRunId: RUN_ID });
    expect(notes[0]?.data).not.toHaveProperty('runId');
    expect(fs.existsSync(clone)).toBe(false);
  }, 60_000);

  // A DELIBERATE decision not to store anything partial: what a run saves
  // becomes the repository's BASELINE, and a board missing the judge's verdicts
  // would be read as the truth about it and diffed against for as long as it
  // stood. The whole run is deterministic apart from that one annotation, so
  // there is nothing expensive to salvage — the resumed job runs it again.
  it('a run stopped by an empty balance stores no board at all, and is carried on as one job', async () => {
    await storeGeneratedSet();
    await saveSetupBundle();
    let attempts = 0;
    runImpl = async (repoRoot, options) => {
      attempts += 1;
      if (attempts === 1) throw new CreditsExhaustedError(ORG, 0);
      return failingRun(repoRoot, options);
    };

    await jobs.enqueueGuardRun(request);
    await Promise.all(running);
    running = [];

    const [job] = await jobsOfType('repo.guard-run');
    expect(job).toMatchObject({ status: 'paused', pauseReason: 'credits', error: null });
    expect(await readGuardLatest(REPO)).toBeNull();

    const [paused] = await jobs.jobStore.listPaused(ORG);
    expect(await jobs.resumePaused(paused!)).toBe(job!.id);
    await Promise.all(running);

    expect(await jobsOfType('repo.guard-run')).toHaveLength(1);
    expect((await jobsOfType('repo.guard-run'))[0]).toMatchObject({ status: 'succeeded' });
    expect((await readGuardLatest(REPO))?.run.runId).toBe(RUN_ID);
    expect(await jobs.jobStore.listPaused(ORG)).toEqual([]);
  }, 60_000);

  it('a run that could not start fails with the runner’s reason and stores nothing', async () => {
    await storeGeneratedSet();
    await saveSetupBundle();
    runImpl = async () =>
      ({
        status: 'build-failed',
        build: { ok: false, command: 'pnpm build', exitCode: 1, timedOut: false, output: '> tsc\n\nsrc/a.ts(1,1): error TS2304\nboom\n' },
      }) as never;

    await jobs.enqueueGuardRun(request);
    await Promise.all(running);

    // The job row keeps the runner's reason AND the build's own last words; the
    // notification shows the first line, which already carries the last of them.
    const [job] = await jobsOfType('repo.guard-run');
    expect(job).toMatchObject({ status: 'failed', error: expect.stringMatching(/pnpm build/) });
    expect(job?.error).toContain('Last output: > tsc | src/a.ts(1,1): error TS2304 | boom');
    expect(job?.error).toMatch(/\n\n> tsc\nsrc\/a\.ts\(1,1\): error TS2304\nboom$/);
    const notes = await new NotificationStore(db).listForOrg(ORG);
    expect(notes[0]?.body).toBe(
      'Build failed (`pnpm build`). No scenarios ran. Last output: > tsc | src/a.ts(1,1): error TS2304 | boom',
    );
    expect(await readGuardLatest(REPO)).toBeNull();
  });

  // The documents a scenario binds to are the WORKSPACE's, not the clone's: a
  // run that does not materialize them resolves every bind against a file that
  // is not there, and the whole board settles orphaned without a build.
  const DOC_PATH = 'docs/orgs.md';

  /** The section the seeded document really holds, as the runner derives it. */
  function seededBind(): StoredBind {
    const doc = contextRef(DOC_PATH);
    const section = buildDocSectionIndex(doc, contextDocBody(DOC_PATH)).sections[0];
    if (!section) throw new Error(`the seeded ${doc} holds no section to bind to`);
    return { doc, section: section.anchor, fingerprint: section.fingerprint };
  }

  it('materializes the document the scenario binds to into the clone', async () => {
    await seedWorkspaceSpec();
    const bind = seededBind();
    await storeGeneratedSet(bind);
    await saveSetupBundle();

    const read: { body?: string | null } = {};
    runImpl = async (repoRoot, options) => {
      const file = path.join(repoRoot, bind.doc);
      read.body = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
      return failingRun(repoRoot, options);
    };

    await jobs.enqueueGuardRun(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-run');
    expect(job?.error).toBeNull();
    expect(read.body).toBe(contextDocBody(DOC_PATH));
  });

  it('binds the stored scenario to that document — a match, not an orphan', async () => {
    await seedWorkspaceSpec();
    const bind = seededBind();
    await storeGeneratedSet(bind);
    await saveSetupBundle();

    const resolved: { missing?: string[]; kind?: string } = {};
    runImpl = async (repoRoot, options) => {
      // The runner's own binding pass, over the clone the job prepared.
      const docs = indexRepoDocs(repoRoot, [bind.doc]);
      resolved.missing = [...docs.missing];
      resolved.kind = resolveBinding(
        docs.indexes.get(bind.doc) ?? null,
        bind.section,
        bind.fingerprint,
      ).kind;
      return failingRun(repoRoot, options);
    };

    await jobs.enqueueGuardRun(request);
    await Promise.all(running);

    expect(resolved.missing).toEqual([]);
    expect(resolved.kind).toBe('match');
  });

  it.each([
    { document: 'unchanged', expected: 'pass' },
    { document: 'changed', expected: 'stale' },
    { document: 'missing', expected: 'orphaned' },
  ] as const)('checks $document workspace documents with the real runner ($expected)', async ({ document, expected }) => {
    const docPath = 'docs/orgs.md';
    const docRef = contextRef(docPath);
    const original = '# Widgets\n\n## Help\nThe command prints help.\n';
    const section = buildDocSectionIndex(docRef, original).sections.find((s) => s.headingText === 'Help')!;
    await storeGeneratedSet({ doc: docRef, section: section.anchor, fingerprint: section.fingerprint });
    await seedWorkspaceSpec(document === 'missing' ? [] : [docPath]);
    if (document !== 'missing') {
      await writeContextDocuments(ORG, SOURCE_ID, {
        documents: [{
          docId: docPath, docPath, title: 'Widgets', url: null,
          contentHash: `sha-${document}`, updatedAt: '2026-01-02T00:00:00.000Z',
          body: document === 'changed' ? original.replace('prints help', 'prints usage examples') : original,
        }],
        removed: [],
      });
    }
    await saveGuardSetupBundle({ repoKey: REPO, commitSha: 'setup-commit' }, {
      '.truecourse/scenarios/recipe.json': JSON.stringify({ build: 'true', entry: [process.execPath] }),
    });
    // Keep the production queue/materialization/persistence and execute the real
    // binding checks and CLI driver. No application server or model is involved.
    runImpl = (repoRoot) => runGuard({ repoRoot, skipBuild: true });

    await jobs.enqueueGuardRun(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-run');
    expect(job?.error).toBeNull();
    expect(job?.status).toBe('succeeded');
    const latest = await readGuardLatest(REPO);
    expect(latest?.scenarios).toHaveLength(1);
    expect(latest?.scenarios[0]).toMatchObject({
      id: 'a1', outcome: expected,
      binds: { doc: docRef, section: section.anchor, fingerprint: section.fingerprint },
    });
    if (expected === 'pass') {
      expect(latest?.scenarios[0].evidencePath).toBeTruthy();
      expect(latest?.summary).toMatchObject({ pass: 1, stale: 0, orphaned: 0 });
    } else {
      expect(latest?.scenarios[0].durationMs).toBe(0);
      expect(latest?.scenarios[0].evidencePath).toBeUndefined();
      expect(latest?.summary[expected]).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Disconnecting under a running job
// ---------------------------------------------------------------------------

describe('disconnecting a repository mid-setup', () => {
  let reached = false;
  const disposedHere: string[] = [];

  beforeEach(async () => {
    reached = false;
    disposedHere.length = 0;
    const dir = makeTmpDir('tc-onboarding-live-');
    setWorkTreeProvider('github', async () => ({
      dir,
      dispose: () => disposedHere.push(dir),
    }));
    setRepoJobsCanceller((repoKey, orgId) => jobs.cancelRepoJobs(repoKey, orgId));
    await seedWorkspaceSpec();
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      startWorker: fakeWorker(),
      guardSetup: {
        startLlm: async () => testLlm,
        // A setup that ends only when it is cancelled: without cancellation the
        // disconnect has nothing to do but refuse.
        runSetup: (_repoRoot, options) =>
          new Promise((_resolve, reject) => {
            reached = true;
            const stop = (): void => reject(new Error('guard setup was cancelled'));
            if (options?.signal?.aborted) stop();
            else options?.signal?.addEventListener('abort', stop, { once: true });
          }),
      },
    });
    await jobs.start();
  });

  it('cancels the running job quietly and disposes its clone', async () => {
    await jobs.enqueueGuardSetup(request);
    await until(() => reached);

    await removeRepoRunState(REPO, ORG);
    await Promise.all(running);

    const [setup] = await jobsOfType('repo.guard-setup');
    expect(setup).toMatchObject({ status: 'cancelled', error: null });
    expect((await new NotificationStore(db).listForOrg(ORG)).map((n) => n.level)).toEqual(['started']);
    expect(disposedHere).toHaveLength(1);
  });

  it('refuses the disconnect when the job is running on another replica', async () => {
    // A row claimed elsewhere: `running`, but not in this process's registry.
    await new JobStore(db).create({
      org: ORG,
      type: 'repo.guard-setup',
      key: `repo.guard-setup:${REPO}`,
      payload: {},
    });
    const [row] = await jobsOfType('repo.guard-setup');
    await new JobStore(db).markRunning(row.id);

    await expect(removeRepoRunState(REPO, ORG)).rejects.toThrow(/another process/i);
    expect((await jobsOfType('repo.guard-setup'))[0]?.status).toBe('running');
  });
});
