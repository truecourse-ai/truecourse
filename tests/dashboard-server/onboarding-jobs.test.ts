/**
 * Onboarding as a chain of background jobs: `repo.scan` → `repo.guard-setup`
 * → `repo.guard-generate` → `repo.guard-run`.
 *
 * What is pinned here is the chain's semantics and the setup job's brackets.
 * The scan enqueues its successor ONLY when it succeeded — a failed or
 * cancelled scan leaves the repository alone. The setup job materializes the
 * stored spec and the newest setup BUNDLE into its ephemeral clone, runs the
 * real engine over it, and saves the bundle back under the clone's commit, so
 * a second run replays the settled steps instead of re-deriving them. The
 * generate job brackets its engine the same way — the stored spec, the repo's
 * guard decisions, the baseline scenario set and setup's bundle go into the
 * clone; the scenario tree, the baseline report and the birth evidence come
 * out — and stores nothing from a run that authored nothing. The run job closes
 * the chain: the baseline set and setup's bundle go into the clone, the run
 * snapshot and every scenario's evidence bundle — screenshots as bytes — come
 * out as the repo's baseline run. And a disconnect mid-run cancels quietly: no
 * error, no notification, clone gone.
 *
 * The queue itself is real (PGlite + the real harness); only graphile is faked,
 * so a job body runs inline the moment it is enqueued. The LLM never is: the
 * setup sessions come in through their seams and the driver is scripted.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
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
import { JobStore, NotificationStore, PgGuardStore, PgGuardOverlayStore, PgSpecStore } from '@truecourse/data-store';
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
import { setSpecStore, saveSpec } from '@truecourse/core/lib/spec-store';
import {
  listSessionRuns,
  setSessionsRootResolver,
  resetSessionsRootResolver,
} from '@truecourse/core/lib/sessions-store';
import { guardSetupInProcess } from '@truecourse/core/commands/guard-setup';
import { OpenConflictsError } from '@truecourse/core/commands/guard-in-process';
import {
  guardDecisionsPath,
  manifestPath,
  recipePath,
  scenariosDir,
  writeGuardResult as writeCloneGuardResult,
} from '@truecourse/guard-runner';
import { GUARD_FORMAT_VERSION, type GuardGenerateReport, type GuardLatest } from '@truecourse/shared';
import type { LlmTransport } from '@truecourse/shared/llm';
import { createServerJobs, type JobsMount } from '../../apps/dashboard/server/src/jobs/index';
import type { RepoScanTaskDeps } from '../../apps/dashboard/server/src/jobs/tasks/repo-scan';
import type { RepoGuardGenerateTaskDeps } from '../../apps/dashboard/server/src/jobs/tasks/repo-guard-generate';
import type { RepoGuardRunTaskDeps } from '../../apps/dashboard/server/src/jobs/tasks/repo-guard-run';
import { setWorkTreeProvider } from '../../apps/dashboard/server/src/services/work-tree.service';
import {
  removeRepoRunState,
  setRepoJobsCanceller,
} from '../../apps/dashboard/server/src/services/repo-removal.service';
import type { WorkspaceLlm } from '../../apps/dashboard/server/src/services/workspace-llm.service';
import { forbiddenDriver } from '../core/spec-scan-session-stub';

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

/** A provider that answers without a network call, on a driver nothing may reach. */
const testLlm: WorkspaceLlm = {
  mode: 'api',
  driver: () => forbiddenDriver('the setup sessions are stubbed in this suite'),
  transport: (async () => '{}') as LlmTransport,
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

beforeAll(() => {
  process.env.TRUECOURSE_HOME = makeTmpDir('tc-onboarding-home-');
  // The production sessions layout: transcripts keyed by repo identity under the
  // global dir, so they exist independent of any work tree.
  setSessionsRootResolver((key) =>
    path.isAbsolute(key)
      ? path.join(key, '.truecourse', 'sessions')
      : path.join(process.env.TRUECOURSE_HOME as string, 'sessions', key.replace('/', '__')),
  );
});

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setGuardStore(new PgGuardStore(db));
  setGuardOverlayStore(new PgGuardOverlayStore(db, 'master-secret-at-least-32-chars-long!!'));
  setSpecStore(new PgSpecStore(db));
  running = [];
  enqueued = [];
  enqueuedPayloads = [];
  disposed.length = 0;
});

afterEach(async () => {
  await Promise.all(running);
  setRepoJobsCanceller(null);
  setWorkTreeProvider(null);
  await jobs.stop();
  await client.close();
  fs.rmSync(path.join(process.env.TRUECOURSE_HOME as string, 'sessions'), {
    recursive: true,
    force: true,
  });
});

afterAll(() => {
  resetSessionsRootResolver();
  delete process.env.TRUECOURSE_HOME;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const request = { repoId: 'widgets', repoFullName: REPO, workspaceOrgId: ORG, source: 'connect' as const };

type ScanEngine = NonNullable<RepoScanTaskDeps['runScan']>;

/**
 * A scan result with nothing to resolve. Only the corpus + decisions the
 * conflict count derives from are real; the rest of the result shape belongs to
 * the scan's own suites.
 */
const cleanScan = (): Awaited<ReturnType<ScanEngine>> =>
  ({ curate: { corpus: { areas: [] }, decisions: {} } }) as unknown as Awaited<
    ReturnType<ScanEngine>
  >;

const jobsOfType = async (type: string): Promise<JobView[]> =>
  (await new JobStore(db).listForOrg(ORG)).filter((j) => j.type === type);

/** The step checklist a run record mirrors, for a reader with no transcripts. */
const checklistKeys = (run: { display?: { blocks: { kind: string }[] } }): string[] => {
  const block = run.display?.blocks.find((b) => b.kind === 'checklist');
  return ((block as { items: { key: string }[] } | undefined)?.items ?? []).map((i) => i.key);
};

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

describe('a spec scan chains into guard setup', () => {
  /** The scan body's engine, per test. */
  let scanImpl: ScanEngine;

  beforeEach(() => {
    scanImpl = async () => cleanScan();
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      // Only the scan runs: a chained setup is observable as an enqueue without
      // dragging the whole engine into a test about the chain.
      startWorker: fakeWorker(['repo.scan']),
      scan: {
        startLlm: async () => testLlm,
        runScan: (repoKey, options) => scanImpl(repoKey, options),
      },
    });
    return jobs.start();
  });

  it('enqueues the setup job when the scan succeeded', async () => {
    const outcome = await jobs.enqueueScan(request);
    expect(outcome.status).toBe('queued');
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.scan', 'repo.guard-setup']);
    const [setup] = await jobsOfType('repo.guard-setup');
    expect(setup).toMatchObject({ status: 'queued', key: `repo.guard-setup:${REPO}` });
    // The scan itself succeeded, with the spec-ready notification.
    const [scan] = await jobsOfType('repo.scan');
    expect(scan?.status).toBe('succeeded');
    // The chained enqueue addresses ITS row: a payload built from the scan's
    // would carry the scan's id, and the worker would find that row settled
    // and skip setup without a trace.
    expect(enqueuedPayloads[1]).toMatchObject({
      jobId: setup?.id,
      repoFullName: REPO,
      source: 'chain',
    });
    expect(enqueuedPayloads[1]?.jobId).not.toBe(scan?.id);
    const notes = await new NotificationStore(db).listForOrg(ORG);
    expect(notes.map((n) => n.title)).toEqual(['Repository scan complete']);
  });

  it('chains nothing when the scan failed, and says why', async () => {
    scanImpl = async () => {
      throw new Error('the clone went missing');
    };

    await jobs.enqueueScan(request);
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.scan']);
    expect(await jobsOfType('repo.guard-setup')).toEqual([]);
    const [scan] = await jobsOfType('repo.scan');
    expect(scan).toMatchObject({ status: 'failed', error: 'the clone went missing' });
    const notes = await new NotificationStore(db).listForOrg(ORG);
    expect(notes[0]).toMatchObject({ level: 'error', title: 'Repository scan failed' });
  });

  it('chains nothing when the scan was cancelled, and stays quiet', async () => {
    let reached = false;
    scanImpl = (_repoKey, options = {}) =>
      new Promise((_resolve, reject) => {
        reached = true;
        const stop = (): void => reject(new Error('the spec scan was cancelled'));
        if (options.signal?.aborted) stop();
        else options.signal?.addEventListener('abort', stop, { once: true });
      });

    const outcome = await jobs.enqueueScan(request);
    await until(() => reached);
    if (outcome.status !== 'queued') throw new Error('the scan was not queued');
    expect(await jobs.cancel(outcome.jobId)).toBe('cancelled');

    expect(enqueued).toEqual(['repo.scan']);
    expect(await jobsOfType('repo.guard-setup')).toEqual([]);
    const [scan] = await jobsOfType('repo.scan');
    expect(scan).toMatchObject({ status: 'cancelled', error: null });
    // Cancellation is a normal outcome — nobody is told about work they stopped.
    expect(await new NotificationStore(db).listForOrg(ORG)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The setup job, over a real repository
// ---------------------------------------------------------------------------

describe('the guard setup job', () => {
  let clone: string;
  /** Every setup run's session seams — stubbed; their own suites cover them. */
  const catalogCalls: string[] = [];
  /** Whether the clone held the dependencies overlay when the engine looked. */
  const overlaysSeen: boolean[] = [];

  /** A fresh clone of the fixture at a stable path, as a run really gets one. */
  function installWorkTree(): void {
    clone = path.join(makeTmpDir('tc-onboarding-clone-'), 'widgets');
    setWorkTreeProvider(async () => {
      fs.rmSync(clone, { recursive: true, force: true });
      fs.cpSync(FIXTURE, clone, { recursive: true });
      git(clone, 'init', '--initial-branch=main');
      // The suite hides the developer's global git config, so identity is per-repo.
      git(clone, 'config', 'user.name', 'Test');
      git(clone, 'config', 'user.email', 'test@example.com');
      writeRecipe(clone);
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
    installWorkTree();
    // The scan's output, as the store holds it: setup reads the curated doc
    // universe, and the job materializes it into the clone.
    await saveSpec({ repoKey: REPO, commitSha: 'scan-commit' }, 'corpus', {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [{ ref: 'docs/orgs.md', kind: 'prd', lastTouched: '', areaTags: [] }],
      areas: [],
      relations: [],
      skippedDocs: [],
    });
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
              return { status: 'ok', added: [], findings: [] };
            },
            authorInterfaces: async () => ({ status: 'skipped', reason: 'stubbed in this suite' }),
            seedSession: async () => ({ status: 'skipped', reason: 'stubbed in this suite' }),
            verifyAuth: async () => ({ status: 'skipped', reason: 'stubbed in this suite' }),
          }),
      },
    });
    await jobs.start();
  });

  it('saves the bundle under the clone’s commit and records a watchable run', async () => {
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
    const [run] = listSessionRuns(REPO, 'guard-setup');
    expect(run).toMatchObject({ status: 'completed', llm: { mode: 'api', provider: 'test' } });
    expect(checklistKeys(run)).toEqual([
      'recipe',
      'detect',
      'catalog',
      'interfaces',
      'seed',
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

  it('chains scenario generation once the recipe gate held', async () => {
    await jobs.enqueueGuardSetup(request);
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.guard-setup', 'repo.guard-generate']);
    const [generate] = await jobsOfType('repo.guard-generate');
    expect(generate).toMatchObject({ status: 'queued', key: `repo.guard-generate:${REPO}` });
    expect(enqueuedPayloads[1]).toMatchObject({ jobId: generate?.id, repoFullName: REPO, source: 'chain' });
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
        // A setup whose recipe gate failed: the job itself succeeds (the refusal
        // is the report), but there is no recipe to generate against.
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
    expect(setup).toMatchObject({ status: 'succeeded', result: { status: 'failed' } });
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
});

// ---------------------------------------------------------------------------
// The generate job, over a real repository
// ---------------------------------------------------------------------------

describe('the guard generate job', () => {
  let clone: string;
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
    setWorkTreeProvider(async () => {
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
    generateImpl = authoring;
    installWorkTree();
    await saveSpec({ repoKey: REPO, commitSha: 'scan-commit' }, 'corpus', {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [{ ref: 'docs/orgs.md', kind: 'prd', lastTouched: '', areaTags: [] }],
      areas: [],
      relations: [],
      skippedDocs: [],
    });
    // Only the generate runs here: the run it chains into is observed as an
    // enqueue, never executed (its clone would race the assertions below).
    jobs = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      startWorker: fakeWorker(['repo.guard-generate']),
      guardGenerate: {
        startLlm: async () => testLlm,
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

  it('refuses a repository that was never set up, and stores nothing', async () => {
    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-generate');
    expect(job).toMatchObject({ status: 'failed', error: expect.stringMatching(/guard setup/) });
    expect(seen).toEqual([]);
    expect(await readGuardBaselineCommit(REPO)).toBeNull();
    expect(disposed).toEqual([clone]);
  });

  it('materializes the stored state, then saves the set, the baseline report and the evidence', async () => {
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
    expect(notes.map((n) => [n.level, n.title])).toEqual([['warning', 'Scenarios generated — findings to review']]);
    expect(fs.existsSync(clone)).toBe(false);
  }, 60_000);

  it('chains the baseline run once the scenario set is stored', async () => {
    await saveSetupBundle();

    await jobs.enqueueGuardGenerate(request);
    await Promise.all(running);

    expect(enqueued).toEqual(['repo.guard-generate', 'repo.guard-run']);
    expect(enqueuedPayloads[1]).toMatchObject({ repoFullName: REPO, workspaceOrgId: ORG, source: 'chain' });
  });

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
    expect(notes[0]).toMatchObject({ level: 'warning', title: 'Scenario generation blocked' });
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
    expect(await new NotificationStore(db).listForOrg(ORG)).toEqual([]);
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
    setWorkTreeProvider(async () => {
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

  /** What generate left: a stored scenario set and its baseline report. */
  async function storeGeneratedSet(): Promise<void> {
    const dir = makeTmpDir('tc-onboarding-run-set-');
    const orgs = path.join(scenariosDir(dir), 'orgs');
    fs.mkdirSync(orgs, { recursive: true });
    fs.writeFileSync(
      path.join(orgs, 'a1.yaml'),
      ['id: a1', 'title: create an org', 'binds:', '  - doc: docs/orgs.md', '    section: create', '    fingerprint: "sha256:x"', 'steps:', '  - run: ["--help"]', '    expect:', '      exit: 0', ''].join('\n'),
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
    expect(notes.map((n) => [n.level, n.title])).toEqual([['warning', 'Scenarios ran — failures to review']]);
    expect(fs.existsSync(clone)).toBe(false);
  }, 60_000);

  it('a run that could not start fails with the runner’s reason and stores nothing', async () => {
    await storeGeneratedSet();
    await saveSetupBundle();
    runImpl = async () =>
      ({ status: 'build-failed', build: { command: 'pnpm build', exitCode: 1, timedOut: false, stdout: '', stderr: 'boom' } }) as never;

    await jobs.enqueueGuardRun(request);
    await Promise.all(running);

    const [job] = await jobsOfType('repo.guard-run');
    expect(job).toMatchObject({ status: 'failed', error: expect.stringMatching(/pnpm build/) });
    expect(await readGuardLatest(REPO)).toBeNull();
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
    setWorkTreeProvider(async () => ({
      dir,
      dispose: () => disposedHere.push(dir),
    }));
    setRepoJobsCanceller((repoKey, orgId) => jobs.cancelRepoJobs(repoKey, orgId));
    await saveSpec({ repoKey: REPO, commitSha: 'scan-commit' }, 'corpus', {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [],
      areas: [],
      relations: [],
      skippedDocs: [],
    });
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
    expect(await new NotificationStore(db).listForOrg(ORG)).toEqual([]);
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
