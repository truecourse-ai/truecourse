/**
 * THE PULL REQUEST CHECK, one job: the head's pipeline judged against the
 * base's stored state, every exit settling the check's row and GitHub's
 * check. The queue is real (PGlite + the harness), graphile runs bodies
 * inline, the work tree is a fixture copied per clone, GitHub is a fake that
 * answers the merge-base and the changed files and records what is posted,
 * and every engine is a stub — what is under test is the check's decisions,
 * not the engines.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Runner } from 'graphile-worker';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore, PgGuardStore, PgRepositoryStore, RepositoriesRegistryStore } from '@truecourse/data-store';
import { resetRegistryStore, setRegistryStore } from '@truecourse/core/config/registry';
import { registerJob, type JobTask, type StartWorker } from '@truecourse/jobs';
import { manifestPath, scenariosDir, dependenciesLocalPath, API_SERVER_BOOT_EXPECTED } from '@truecourse/guard-runner';
import {
  GUARD_FORMAT_VERSION,
  type GuardGenerateReport,
  type GuardLatest,
  type PullRequestCheckRecord,
  type PullRequestRecord,
} from '@truecourse/shared';
import {
  listGuardVersions,
  readGuardHistory,
  resetGuardStore,
  saveGuardSetupBundle,
  saveScenarios,
  setGuardStore,
  writeGuardLatest,
  writeGuardResult,
  writeGuardRunCoverage,
} from '@truecourse/core/lib/guard-store';
import { resetContextStore, setContextBindings, setContextStore, type ContextStore } from '@truecourse/core/lib/context-store';
import { resetSpecStore, setSpecStore } from '@truecourse/core/lib/spec-store';
import { CreditsExhaustedError } from '@truecourse/core/lib/credits-store';
import { listStoredSessionRuns } from '@truecourse/core/lib/sessions-store';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { memoryContextStore } from '../helpers/memory-context-store';
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import { writeGuardOverlays } from '@truecourse/core/lib/guard-overlays';
import { memorySpecStore } from '../helpers/memory-spec-store';
import { memoryPullRequestStore, type MemoryPullRequestStore } from '../helpers/memory-pull-requests';
import { createServerJobs, type JobsMount } from '../../apps/dashboard/server/src/jobs/index';
import type { RepoPullRequestCheckTaskDeps } from '../../apps/dashboard/server/src/jobs/tasks/repo-pr-check';
import { setWorkTreeProvider, type WorkTreeVia } from '../../apps/dashboard/server/src/services/work-tree.service';
import { setContextEventPublisher } from '../../apps/dashboard/server/src/services/context.service';
import type { WorkspaceLlm } from '../../apps/dashboard/server/src/services/workspace-llm.service';
import type { OctokitClient } from '../../packages/github-app/src/octokit';

const ORG = 'org_A';
const REPO = 'acme/widgets';
const BASE = 'base-1';
const HEAD = 'head-1';
const SOURCE = 'repo-acme-widgets';

let client: PGlite;
let db: Db;
let jobs: JobsMount;
let pulls: MemoryPullRequestStore;
let repos: PgRepositoryStore;
let context: ContextStore;
let home: string;
let running: Promise<void>[];
/** Every clone: what was asked for and the tree handed back. */
let clones: { via: WorkTreeVia | undefined; dir: string }[];
let github: { method: string; params: Record<string, unknown> }[];
let mergeBase: string;
let changedFiles: string[];
/** The engines, replaceable per test. */
let engines: {
  setup: NonNullable<RepoPullRequestCheckTaskDeps['runSetup']>;
  generate: NonNullable<RepoPullRequestCheckTaskDeps['runGenerate']>;
  run: NonNullable<RepoPullRequestCheckTaskDeps['runGuard']>;
  scan: NonNullable<RepoPullRequestCheckTaskDeps['runScan']>;
};
/** What each engine saw of the tree when it ran. */
let seen: { setupHadOverlays: boolean | null; scanned: boolean };
/** The checks a disconnect or a boot reap asked to settle, by pull request number. */
let cancelledChecks: number[];

const testLlm = {
  mode: 'api',
  driver: () => ({ attribution: { provider: 'test', model: 'test-model' } }) as never,
} as unknown as WorkspaceLlm;

const hub = { start: async () => {}, stop: async () => {}, subscribe: () => () => {} };

const octokit = {
  repos: {
    compareCommitsWithBasehead: async () => ({ data: { merge_base_commit: { sha: mergeBase } } }),
  },
  pulls: { listFiles: 'listFiles' },
  paginate: async () => changedFiles.map((filename) => ({ filename })),
  checks: {
    create: async (params: Record<string, unknown>) => {
      github.push({ method: 'create', params });
      return { data: { id: 77 } };
    },
    update: async (params: Record<string, unknown>) => {
      github.push({ method: 'update', params });
      return { data: {} };
    },
  },
} as unknown as OctokitClient;

const settle = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** graphile, faked with its one rule: a named queue runs its jobs one at a time, in order. */
const laneWorker: StartWorker<Record<string, unknown>> = async ({ rt, tasks }) => {
  const handlers = new Map(tasks.map((t: JobTask) => [t.type, registerJob(rt, t)] as const));
  const lanes = new Map<string, Promise<void>>();
  return {
    addJob: async (task: string, payload: unknown, spec: { queueName?: string } = {}) => {
      const handler = handlers.get(task)!;
      const start = (): Promise<void> => handler(payload, {}).catch(() => undefined);
      if (!spec.queueName) {
        running.push(start());
        return;
      }
      const tail = (lanes.get(spec.queueName) ?? Promise.resolve()).then(start);
      lanes.set(spec.queueName, tail);
      running.push(tail);
    },
    stop: async () => {},
  } as unknown as Runner;
};

/** A head tree: the fixture's docs, so the spec half has documents to walk. */
function installWorkTree(): void {
  setWorkTreeProvider('github', async (_repoKey, via) => {
    const dir = fs.mkdtempSync(path.join(home, 'clone-'));
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'orgs.md'), '# Orgs\n\nAn org can be created.\n');
    clones.push({ via, dir });
    return { dir, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
  });
}

const report = (): GuardGenerateReport => ({
  generatedAt: '2026-01-01T00:00:00Z',
  status: 'ok',
  noChanges: false,
  written: [],
  birthFindings: [],
  sectionsTotal: 0,
  sectionsChanged: 0,
  skippedUnchanged: 0,
  coverageGaps: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
});

/** A run of the one-flow set, with scenario a1 at `outcome`. */
function latestOf(runId: string, commit: string, outcome: 'pass' | 'fail' | 'error', failure?: { expected: string; actual: string }): GuardLatest {
  return {
    run: { runId, ranAt: '2026-09-01T10:00:00.000Z', branch: 'main', commit, recipeFingerprint: 'sha256:r' },
    summary: { total: 1, pass: outcome === 'pass' ? 1 : 0, fail: outcome === 'fail' ? 1 : 0, stale: 0, orphaned: 0, error: outcome === 'error' ? 1 : 0 },
    scenarios: [
      {
        id: 'a1',
        title: 'create an org',
        binds: { doc: 'docs/orgs.md', section: 'orgs', fingerprint: 'sha256:x' },
        outcome,
        durationMs: 1,
        ...(failure ? { failure: { step: 1, ...failure } } : {}),
      },
    ],
    sections: [],
  } as GuardLatest;
}

/** The base at `commit`: a one-flow scenario set, a bundle, a report and a passing run. */
async function storeBase(commit = BASE): Promise<void> {
  const dir = fs.mkdtempSync(path.join(home, 'base-'));
  const orgs = path.join(scenariosDir(dir), 'orgs');
  fs.mkdirSync(orgs, { recursive: true });
  fs.writeFileSync(
    path.join(orgs, 'a1.yaml'),
    ['id: a1', 'title: create an org', 'binds:', '  - doc: docs/orgs.md', '    section: orgs', '    fingerprint: "sha256:x"', 'steps:', '  - run: ["--help"]', '    expect:', '      exit: 0', ''].join('\n'),
  );
  fs.writeFileSync(
    manifestPath(dir),
    JSON.stringify({
      version: GUARD_FORMAT_VERSION,
      flows: [
        {
          flowId: 'f1',
          flowFingerprint: 'sha256:f',
          bindings: [{ doc: 'docs/orgs.md', anchor: 'orgs', fingerprint: 'sha256:x' }],
          scenarios: [{ id: 'a1', drivers: ['cli'] }],
          interfaces: [],
          generationInputsHash: null,
        },
      ],
    }) + '\n',
  );
  const ref = { repoKey: REPO, commitSha: commit };
  await saveScenarios(ref, scenariosDir(dir));
  await writeGuardResult(ref, report());
  await saveGuardSetupBundle(ref, { '.truecourse/scenarios/recipe.json': JSON.stringify({ build: 'true', api: { serve: ['node', 'server.mjs'], healthPath: '/health' } }) + '\n' });
  const run = latestOf(`run-${commit}`, commit, 'pass');
  await writeGuardLatest(REPO, run);
  await writeGuardRunCoverage(REPO, { runId: run.run.runId, ranAt: run.run.ranAt, commit, sections: {}, flows: { f1: 'succeeded' } });
}

function pr(over: Partial<PullRequestRecord> = {}): PullRequestRecord {
  return {
    repoFullName: REPO,
    number: 7,
    workspaceOrgId: ORG,
    provider: 'github',
    title: 'Add widgets',
    authorLogin: 'octocat',
    headSha: HEAD,
    headRef: 'feature',
    baseRef: 'main',
    headRepoFullName: REPO,
    draft: false,
    state: 'open',
    openedAt: '2026-09-20T10:00:00.000Z',
    closedAt: null,
    updatedAt: '2026-09-21T10:00:00.000Z',
    ...over,
  };
}

/** Enqueue a check of `record` and wait for it to settle; answers the settled row. */
async function check(record = pr()): Promise<PullRequestCheckRecord> {
  await pulls.savePullRequest(record);
  const row = await pulls.createCheck({ repoFullName: REPO, number: record.number, headSha: record.headSha });
  await pulls.updateCheck(row.id, { githubCheckRunId: 77 });
  const outcome = await jobs.enqueuePullRequestCheck({
    repoId: 'widgets',
    repoFullName: REPO,
    workspaceOrgId: ORG,
    source: 'pull-request',
    number: record.number,
    headSha: record.headSha,
    checkId: row.id,
    installationId: 5,
  });
  expect(outcome.status).toBe('queued');
  await Promise.all(running);
  await settle(20);
  return (await pulls.getCheck(row.id))!;
}

const lastGithubUpdate = () => github.filter((c) => c.method === 'update').at(-1)?.params;

beforeAll(async () => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pr-check-')));
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterAll(async () => {
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(async () => {
  running = [];
  clones = [];
  github = [];
  mergeBase = BASE;
  changedFiles = [];
  seen = { setupHadOverlays: null, scanned: false };
  cancelledChecks = [];
  engines = {
    setup: async (repoRoot) => {
      seen.setupHadOverlays = fs.existsSync(dependenciesLocalPath(repoRoot));
      return { report: { ranAt: '2026-01-01T00:00:00Z', status: 'ok', reason: '', steps: [] }, reportPath: '', sessionsRunDirs: [] } as never;
    },
    generate: async () => ({ guard: report() }) as never,
    run: async () => ({ status: 'ok', latest: latestOf('run-head', HEAD, 'pass') }) as never,
    scan: async () => {
      seen.scanned = true;
      return { corpus: { version: 3, generatedAt: '', docs: [], areas: [], skippedDocs: [] } } as never;
    },
  };
  await db.delete(schema.guardRuns);
  await db.delete(schema.guardResults);
  await db.delete(schema.guardScenarioSets);
  await db.delete(schema.guardSetupSets);
  await db.delete(schema.jobs);
  await db.delete(schema.content);
  await db.delete(schema.repositories);
  pulls = memoryPullRequestStore();
  repos = new PgRepositoryStore(db);
  setRegistryStore(new RepositoriesRegistryStore(db));
  context = memoryContextStore();
  installMemorySessionRuns();
  installMemoryGuardOverlays();
  setGuardStore(new PgGuardStore(db));
  setContextStore(context);
  setSpecStore(memorySpecStore());
  setContextEventPublisher(() => {});
  installWorkTree();
  await repos.linkRepo({
    repoFullName: REPO,
    provider: 'github',
    accountId: '5',
    workspaceOrgId: ORG,
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  jobs = createServerJobs({
    db,
    connectionString: 'postgres://unused',
    hub,
    repos,
    startWorker: laneWorker,
    pullRequestCheck: {
      pulls,
      repos,
      octokitFor: () => octokit,
      appUrl: 'https://app',
      onStopped: async (_repo, number, reason) => {
        cancelledChecks.push(number);
        const active = await pulls.activeCheck(REPO, number);
        if (active) await pulls.settleCheck(active.id, { conclusion: 'neutral', reason });
      },
      startLlm: async () => testLlm,
      runSetup: (root, opts) => engines.setup(root, opts),
      runGenerate: (root, opts) => engines.generate(root, opts),
      runGuard: (root, opts) => engines.run(root, opts),
      runScan: (opts) => engines.scan(opts),
    },
  });
  await jobs.start();
});

afterEach(async () => {
  await Promise.all(running);
  await jobs.stop();
  setWorkTreeProvider('github', null);
  setContextEventPublisher(null);
  resetGuardStore();
  resetContextStore();
  resetSpecStore();
  resetSessionRuns();
  resetGuardOverlayStore();
  resetRegistryStore();
});

describe('the pull request check', () => {
  it('runs the pipeline at the head over the base, stores it under the pull request’s scope, and concludes clean', async () => {
    await storeBase();
    const settled = await check();

    expect(settled).toMatchObject({ status: 'settled', conclusion: 'success', reason: 'clean', mergeBaseSha: BASE, baseCommitSha: BASE });
    expect(settled.report).toMatchObject({
      base: { mergeBase: BASE, commit: BASE, nearestWithBase: null },
      fork: false,
      specHalf: 'not-a-source',
      codeHalf: 'ran',
      run: { runId: 'run-head', counts: { newFailures: 0, preExisting: 0, fixed: 0, newlyBlocked: 0, added: 0, retired: 0 } },
    });
    // The head was fetched under its own branch name.
    expect(clones[0]!.via).toMatchObject({ commitSha: HEAD, defaultBranch: 'feature' });
    // Every version the head produced lives under the pull request's scope; the default line is untouched.
    expect((await listGuardVersions(REPO, 'setup', { scope: 'pr/7' })).map((v) => v.commitSha)).toEqual([HEAD]);
    expect((await listGuardVersions(REPO, 'scenarios', { scope: 'pr/7' })).map((v) => v.commitSha)).toEqual([HEAD]);
    expect((await listGuardVersions(REPO, 'scenarios')).map((v) => v.commitSha)).toEqual([BASE]);
    const prRuns = (await readGuardHistory(REPO, { scope: 'pr/7' })).runs;
    expect(prRuns.map((r) => [r.runId, r.pullRequest])).toEqual([['run-head', 7]]);
    expect((await readGuardHistory(REPO)).runs.map((r) => r.runId)).toEqual([`run-${BASE}`]);
    // GitHub's check moved to in progress with the run's page, then completed.
    expect(github.map((c) => [c.params.status, c.params.conclusion])).toEqual([
      ['in_progress', undefined],
      ['completed', 'success'],
    ]);
    expect(lastGithubUpdate()!.details_url).toMatch(/^https:\/\/app\/agent\//);
    // The run record names the pull request.
    const runs = await listStoredSessionRuns(REPO, 'pr-check');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed', gitRef: HEAD, pullRequest: { number: 7, headSha: HEAD, checkId: settled.id } });
    // And the registered instances went into the tree: not a fork.
    expect(seen.setupHadOverlays).toBe(false);
  });

  it('a flow that held at the base and fails at the head is a new failure, and fails the check', async () => {
    await storeBase();
    engines.run = async () => ({ status: 'ok', latest: latestOf('run-head', HEAD, 'fail', { expected: 'exit 0', actual: 'exit 1' }) }) as never;
    const settled = await check();
    expect(settled).toMatchObject({ conclusion: 'failure', reason: 'new-failures' });
    expect(settled.report?.run).toMatchObject({
      counts: { newFailures: 1 },
      newFailures: [{ id: 'f1', scenarioIds: ['a1'] }],
    });
    expect(lastGithubUpdate()).toMatchObject({ conclusion: 'failure' });
  });

  it('skips a head whose merge-base has nothing stored, naming the newest commit that has', async () => {
    await storeBase();
    mergeBase = 'base-9';
    const settled = await check();
    expect(settled).toMatchObject({ conclusion: 'neutral', reason: 'no-base' });
    expect(settled.report).toMatchObject({ base: { mergeBase: 'base-9', commit: null, nearestWithBase: BASE }, codeHalf: 'not-run' });
    // Nothing ran; the head was fetched once to find that out.
    expect(seen.setupHadOverlays).toBeNull();
    expect((await listGuardVersions(REPO, 'setup', { scope: 'pr/7' }))).toEqual([]);
    expect(lastGithubUpdate()).toMatchObject({ conclusion: 'neutral' });
  });

  it('a setup that fails at the head is the pull request’s failure', async () => {
    await storeBase();
    engines.setup = async () => ({ report: { ranAt: '', status: 'failed', reason: 'the recipe needs a database nobody provides', steps: [] }, reportPath: '', sessionsRunDirs: [] }) as never;
    const settled = await check();
    expect(settled).toMatchObject({ conclusion: 'failure', reason: 'build-failed' });
    expect(settled.report?.run).toBeNull();
  });

  it('a head whose world never comes up is the pull request’s failure, never a board of blocked flows', async () => {
    await storeBase();
    engines.run = async () => ({ status: 'build-failed', build: { output: 'npm ERR!' }, loadErrors: [] }) as never;
    expect(await check()).toMatchObject({ conclusion: 'failure', reason: 'build-failed' });

    engines.run = async () => ({
      status: 'ok',
      latest: latestOf('run-head', HEAD, 'error', { expected: API_SERVER_BOOT_EXPECTED, actual: 'connection refused' }),
    }) as never;
    expect(await check(pr({ number: 8 }))).toMatchObject({ conclusion: 'failure', reason: 'build-failed' });
  });

  it('runs a fork without the registered instances', async () => {
    await storeBase();
    await writeGuardOverlays(REPO, { dependencies: { version: 1, provided: {} }, externals: { version: 1, provided: {} } } as never);
    engines.setup = async (repoRoot) => {
      seen.setupHadOverlays = fs.existsSync(dependenciesLocalPath(repoRoot));
      return { report: { ranAt: '', status: 'ok', reason: '', steps: [] }, reportPath: '', sessionsRunDirs: [] } as never;
    };
    await check(pr({ number: 9, headRepoFullName: 'octocat/widgets' }));
    expect(seen.setupHadOverlays).toBe(false);
    expect((await pulls.latestCheck(REPO, 9))?.report?.fork).toBe(true);

    await check(pr({ number: 10 }));
    expect(seen.setupHadOverlays).toBe(true);
  });

  it('scans the head when a document in the source’s scope changed, and stops on a conflict it creates', async () => {
    await storeBase();
    await context.createSource(ORG, {
      id: SOURCE,
      kind: 'repository',
      title: REPO,
      config: { repoFullName: REPO, installationId: 5, include: ['docs/**'], exclude: [], branch: 'main' },
    });
    await setContextBindings(ORG, REPO, [SOURCE]);
    changedFiles = ['docs/orgs.md', 'src/index.ts'];
    const disputed: CuratedCorpus = {
      version: 3,
      generatedAt: '',
      docs: [
        { ref: `context/${SOURCE}/docs/orgs.md`, kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SOURCE },
        { ref: `context/${SOURCE}/docs/other.md`, kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SOURCE },
      ],
      areas: [
        {
          id: 'p/c',
          product: 'p',
          concern: 'c',
          docRefs: [`context/${SOURCE}/docs/orgs.md`, `context/${SOURCE}/docs/other.md`],
          overlaps: [
            {
              docs: [`context/${SOURCE}/docs/orgs.md`, `context/${SOURCE}/docs/other.md`],
              note: 'one org vs many',
              sections: [
                { doc: `context/${SOURCE}/docs/orgs.md`, heading: 'Orgs', quote: 'An org can be created.' },
                { doc: `context/${SOURCE}/docs/other.md`, heading: 'Limits', quote: 'Only one org.' },
              ],
              areas: [],
            },
          ],
        },
      ],
      skippedDocs: [],
    };
    engines.scan = async (opts) => {
      seen.scanned = true;
      expect(opts.pullRequest).toMatchObject({ repoFullName: REPO, number: 7, headSha: HEAD, scope: 'pr/acme/widgets#7', sourceId: SOURCE });
      expect(opts.pullRequest!.documents.map((d) => d.docPath)).toEqual(['docs/orgs.md']);
      return { corpus: disputed } as never;
    };

    const settled = await check();
    expect(seen.scanned).toBe(true);
    expect(settled).toMatchObject({ conclusion: 'failure', reason: 'conflict' });
    expect(settled.report).toMatchObject({ specHalf: 'ran', codeHalf: 'stopped-by-conflict', run: null });
    expect(settled.report?.conflictsCreated).toEqual([
      {
        docs: [`context/${SOURCE}/docs/orgs.md`, `context/${SOURCE}/docs/other.md`],
        sections: [['Orgs'], ['Limits']],
        note: 'one org vs many',
        path: 'docs/orgs.md',
        line: 1,
        blocksRepositories: [REPO],
      },
    ]);
    // The conflict is annotated on the changed document's heading line.
    expect((lastGithubUpdate()!.output as { annotations: unknown[] }).annotations).toEqual([
      { path: 'docs/orgs.md', start_line: 1, end_line: 1, annotation_level: 'failure', message: expect.stringContaining('one org vs many') },
    ]);
    // Nothing of the code half ran.
    expect(seen.setupHadOverlays).toBeNull();
  });

  it('skips the scan when the head changed nothing in the source’s scope', async () => {
    await storeBase();
    await context.createSource(ORG, {
      id: SOURCE,
      kind: 'repository',
      title: REPO,
      config: { repoFullName: REPO, installationId: 5, include: ['docs/**'], exclude: [], branch: 'main' },
    });
    changedFiles = ['src/index.ts'];
    const settled = await check();
    expect(seen.scanned).toBe(false);
    expect(settled.report).toMatchObject({ specHalf: 'no-documents-changed', codeHalf: 'ran' });
  });

  it('checks a repository only a source reads for its documents alone', async () => {
    await repos.unlinkRepo(REPO);
    await storeBase();
    const settled = await check();
    expect(settled).toMatchObject({ conclusion: 'success', reason: 'clean' });
    expect(settled.report).toMatchObject({ specHalf: 'not-a-source', codeHalf: 'not-connected', run: null });
    expect(seen.setupHadOverlays).toBeNull();
  });

  it('a disconnect settles every check of the repository, the one still waiting in the lane included', async () => {
    await storeBase();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    engines.setup = async () => {
      await held;
      return { report: { ranAt: '', status: 'ok', reason: '', steps: [] }, reportPath: '', sessionsRunDirs: [] } as never;
    };
    await pulls.savePullRequest(pr());
    await pulls.savePullRequest(pr({ number: 8, headSha: 'head-8' }));
    const rows = [];
    for (const number of [7, 8]) {
      const row = await pulls.createCheck({ repoFullName: REPO, number, headSha: number === 7 ? HEAD : 'head-8' });
      rows.push(row);
      await jobs.enqueuePullRequestCheck({ repoId: 'widgets', repoFullName: REPO, workspaceOrgId: ORG, source: 'pull-request', number, headSha: row.headSha, checkId: row.id, installationId: 5 });
    }
    await settle(50);
    // #7 holds the lane; #8 waits behind it, its body never started.
    expect((await new JobStore(db).listActive(ORG)).map((j) => j.status).sort()).toEqual(['queued', 'running']);
    const cancelling = jobs.cancelRepoJobs(REPO, ORG);
    await settle(20);
    release();
    expect(await cancelling).toBe('stopped');
    await Promise.all(running);
    expect(cancelledChecks.sort()).toEqual([7, 8]);
    expect((await pulls.getCheck(rows[1]!.id))).toMatchObject({ status: 'settled', reason: 'cancelled' });
    expect((await pulls.getCheck(rows[0]!.id))).toMatchObject({ status: 'settled', reason: 'cancelled' });
    expect(await new JobStore(db).listActive(ORG)).toEqual([]);
  });

  it('settles cancelled when the repository is disconnected mid-check', async () => {
    await storeBase();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    engines.setup = async () => {
      await held;
      return { report: { ranAt: '', status: 'ok', reason: '', steps: [] }, reportPath: '', sessionsRunDirs: [] } as never;
    };
    await pulls.savePullRequest(pr());
    const row = await pulls.createCheck({ repoFullName: REPO, number: 7, headSha: HEAD });
    await pulls.updateCheck(row.id, { githubCheckRunId: 77 });
    await jobs.enqueuePullRequestCheck({ repoId: 'widgets', repoFullName: REPO, workspaceOrgId: ORG, source: 'pull-request', number: 7, headSha: HEAD, checkId: row.id, installationId: 5 });
    await settle(50);
    const cancelling = jobs.cancelRepoJobs(REPO, ORG);
    await settle(20);
    release();
    expect(await cancelling).toBe('stopped');
    await Promise.all(running);
    // The disconnect settled the row (the service tells GitHub on that path);
    // the job's own settle found it settled and left it.
    expect(await pulls.getCheck(row.id)).toMatchObject({ status: 'settled', conclusion: 'neutral', reason: 'cancelled' });
    expect(cancelledChecks).toEqual([7]);
  });

  it('a check the process died under is settled at the next boot, and GitHub told', async () => {
    await storeBase();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    engines.setup = async () => {
      await held;
      return { report: { ranAt: '', status: 'ok', reason: '', steps: [] }, reportPath: '', sessionsRunDirs: [] } as never;
    };
    await pulls.savePullRequest(pr());
    const row = await pulls.createCheck({ repoFullName: REPO, number: 7, headSha: HEAD });
    await pulls.updateCheck(row.id, { githubCheckRunId: 77 });
    await jobs.enqueuePullRequestCheck({ repoId: 'widgets', repoFullName: REPO, workspaceOrgId: ORG, source: 'pull-request', number: 7, headSha: HEAD, checkId: row.id, installationId: 5 });
    await settle(50);
    expect(await pulls.getCheck(row.id)).toMatchObject({ status: 'running' });

    // The next process: its boot sweep reaps the row the dead one left running.
    const reborn = createServerJobs({
      db,
      connectionString: 'postgres://unused',
      hub,
      repos,
      startWorker: laneWorker,
      pullRequestCheck: {
        pulls,
        repos,
        octokitFor: () => octokit,
        appUrl: 'https://app',
        onStopped: async (_repo, number, reason) => {
          cancelledChecks.push(number);
          const active = await pulls.activeCheck(REPO, number);
          if (active) await pulls.settleCheck(active.id, { conclusion: 'neutral', reason });
        },
      },
    });
    await reborn.start();
    expect(cancelledChecks).toEqual([7]);
    expect(await pulls.getCheck(row.id)).toMatchObject({ status: 'settled', conclusion: 'neutral', reason: 'error' });
    expect(await new JobStore(db).listActive(ORG)).toEqual([]);
    release();
    await Promise.all(running);
    await reborn.stop();
  });

  it('a head superseded while its check runs keeps the webhook’s word, and GitHub is not told twice', async () => {
    await storeBase();
    let superseded: PullRequestCheckRecord | null = null;
    engines.run = async () => {
      // A newer head arrived: the webhook settled the row while the runner ran.
      const active = await pulls.activeCheck(REPO, 7);
      superseded = await pulls.settleCheck(active!.id, { conclusion: 'neutral', reason: 'superseded' });
      return { status: 'ok', latest: latestOf('run-head', HEAD, 'pass') } as never;
    };
    const settled = await check();
    expect(superseded).not.toBeNull();
    expect(settled).toMatchObject({ status: 'settled', conclusion: 'neutral', reason: 'superseded', report: null });
    expect(github.filter((c) => c.method === 'update' && c.params.status === 'completed')).toEqual([]);
  });

  it('settles as paused on credits, and the resume is a new attempt with a check of its own', async () => {
    await storeBase();
    engines.setup = async () => {
      throw new CreditsExhaustedError('out of credits');
    };
    const settled = await check();
    expect(settled).toMatchObject({ status: 'settled', conclusion: 'neutral', reason: 'credits' });
    const [paused] = await new JobStore(db).listPaused(ORG);
    expect(paused?.type).toBe('repo.pr-check');

    engines.setup = async () =>
      ({ report: { ranAt: '', status: 'ok', reason: '', steps: [] }, reportPath: '', sessionsRunDirs: [] }) as never;
    running = [];
    expect(await jobs.resumePaused(paused!)).toBe(paused!.id);
    await Promise.all(running);
    await settle(20);

    // A second row on the same head, posted to GitHub as a check of its own and completed there.
    expect(pulls.checks.map((c) => c.attempt)).toEqual([1, 2]);
    const attempt = pulls.checks[1]!;
    expect(attempt).toMatchObject({ status: 'settled', conclusion: 'success', reason: 'clean', githubCheckRunId: 77, jobId: paused!.id });
    expect(github.filter((c) => c.method === 'create')).toHaveLength(1);
    expect(lastGithubUpdate()).toMatchObject({ check_run_id: 77, status: 'completed', conclusion: 'success' });
  });
});
