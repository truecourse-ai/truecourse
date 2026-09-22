/**
 * THE MAIN CHAIN ON PUSH: a push to the default branch runs setup → generate
 * → run at the pushed tip, PINNED to one commit and COALESCED per repository.
 *
 * What is pinned here: the chain's later links clone the commit setup cloned,
 * not whatever the branch's tip is by then; a push that lands while a heavy
 * job of the repository is active starts nothing; and when that chain ends
 * the mount runs exactly ONE more chain for every push that landed meanwhile,
 * stopping once the branch's newest commit is the one a chain worked on.
 *
 * The queue is real (PGlite + the harness), graphile is faked with its one
 * rule (a named queue runs one job at a time) and every heavy body is frozen
 * where it acquires its work tree, so "which link is running, at which
 * commit" is exact. The engines are stubbed: setup settles a recipe and
 * chains; generate stops on the empty spec (this workspace scanned nothing),
 * which is a chain ending like any other.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Runner } from 'graphile-worker';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore, PgGuardStore } from '@truecourse/data-store';
import { registerJob, type JobTask, type StartWorker } from '@truecourse/jobs';
import type { JobView } from '@truecourse/shared';
import { resetGuardStore, setGuardStore } from '@truecourse/core/lib/guard-store';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import { resetSpecStore, setSpecStore } from '@truecourse/core/lib/spec-store';
import { memoryContextStore } from '../helpers/memory-context-store';
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import { memorySpecStore } from '../helpers/memory-spec-store';
import { MemoryInstallationStore } from '../github-app/memory-store';
import { createServerJobs, type JobsMount } from '../../apps/dashboard/server/src/jobs/index';
import { setWorkTreeProvider, type WorkTreeVia } from '../../apps/dashboard/server/src/services/work-tree.service';
import { setContextEventPublisher } from '../../apps/dashboard/server/src/services/context.service';
import type { WorkspaceLlm } from '../../apps/dashboard/server/src/services/workspace-llm.service';

let ORG: string;
let REPO: string;
let counter = 0;

let client: PGlite;
let db: Db;
let jobs: JobsMount;
let repos: MemoryInstallationStore;
let home: string;
/** The one tree every clone of a test is, so every clone resolves the same commit. */
let tree: { dir: string; head: string };
let running: Promise<void>[];

const testLlm = {
  mode: 'api',
  driver: () => ({ attribution: { provider: 'test', model: 'test-model' } }) as never,
} as unknown as WorkspaceLlm;

const hub = { start: async () => {}, stop: async () => {}, subscribe: () => () => {} };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const settle = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await settle();
  }
  throw new Error('timed out waiting for the queue to move');
}

/** One heavy body, stopped at its clone: what it asked for, and the hold that frees it. */
interface Acquisition {
  repoKey: string;
  via: WorkTreeVia | undefined;
  released: boolean;
  release(): void;
}

let acquisitions: Acquisition[];

const bodyStarted = (nth: number): Promise<void> => until(() => acquisitions.length >= nth);

function oneCommitRepo(): { dir: string; head: string } {
  const dir = fs.mkdtempSync(path.join(home, 'repo-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), '# repo\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  return { dir, head: git('rev-parse', 'HEAD') };
}

function installFrozenWorkTree(): void {
  setWorkTreeProvider('github', async (repoKey, via) => {
    const hold = deferred<void>();
    const acquisition: Acquisition = {
      repoKey,
      via,
      released: false,
      release: () => {
        acquisition.released = true;
        hold.resolve();
      },
    };
    acquisitions.push(acquisition);
    await hold.promise;
    // A copy per acquisition: a body writes into its tree and disposes it.
    const dir = fs.mkdtempSync(path.join(home, 'clone-'));
    fs.cpSync(tree.dir, dir, { recursive: true });
    return { dir, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
  });
}

/** graphile's one rule: a named queue runs its jobs one at a time, in order. */
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

function mount(): JobsMount {
  return createServerJobs({
    db,
    connectionString: 'postgres://unused',
    hub,
    repos,
    startWorker: laneWorker,
    guardSetup: {
      startLlm: async () => testLlm,
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
      sliceDocuments: async () => 2,
    },
    guardGenerate: { startLlm: async () => testLlm, runGenerate: async () => ({}) as never },
    guardRun: { startLlm: async () => testLlm, runGuard: async () => ({}) as never },
  });
}

const rowsOfType = async (type: string): Promise<JobView[]> =>
  (await new JobStore(db).listForOrg(ORG)).filter((j) => j.type === type);

const request = () => ({ repoId: 'widgets', repoFullName: REPO, workspaceOrgId: ORG });

async function linkRepo(): Promise<void> {
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
}

beforeAll(async () => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-push-home-')));
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

afterAll(async () => {
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(async () => {
  counter += 1;
  ORG = `org_push_${counter}`;
  REPO = `acme/widgets-${counter}`;
  running = [];
  acquisitions = [];
  tree = oneCommitRepo();
  repos = new MemoryInstallationStore();
  installMemorySessionRuns();
  installMemoryGuardOverlays();
  setGuardStore(new PgGuardStore(db));
  setContextStore(memoryContextStore());
  setSpecStore(memorySpecStore());
  setContextEventPublisher(() => {});
  installFrozenWorkTree();
  await linkRepo();
  jobs = mount();
  await jobs.start();
});

/**
 * Let every frozen body go and wait for the lane to empty — a released link
 * enqueues the next one from its settle hook, so this loops until nothing new
 * arrives. Nothing may still be running when the suite moves on.
 */
async function drainLane(): Promise<void> {
  for (;;) {
    for (const acquisition of acquisitions) if (!acquisition.released) acquisition.release();
    const pending = running.slice();
    await Promise.all(pending);
    await settle(20);
    if (running.length === pending.length && acquisitions.every((a) => a.released)) return;
  }
}

afterEach(async () => {
  await drainLane();
  await jobs?.stop();
  setWorkTreeProvider('github', null);
  setContextEventPublisher(null);
  resetGuardStore();
  resetContextStore();
  resetSpecStore();
  resetSessionRuns();
  resetGuardOverlayStore();
});

describe('a push to the default branch', () => {
  it('starts a setup pinned to the pushed commit, and the chain it starts stays on it', async () => {
    await repos.recordDefaultBranchSha(REPO, tree.head);
    expect(await jobs.startMainChain(request())).toMatchObject({ status: 'queued' });
    await bodyStarted(1);
    expect(acquisitions[0]!.via).toMatchObject({ workspaceOrgId: ORG, commitSha: tree.head });
    acquisitions[0]!.release();

    // The generate it chains asks for THAT commit, not the tip.
    await bodyStarted(2);
    expect(acquisitions[1]!.via).toMatchObject({ workspaceOrgId: ORG, commitSha: tree.head });
    acquisitions[1]!.release();
    await drainLane();

    const setups = await rowsOfType('repo.guard-setup');
    expect(setups).toHaveLength(1);
    expect((setups[0]!.result as { status?: string } | null)?.status).toBe('ok');
  });

  it('clones the tip when no push has been recorded', async () => {
    await jobs.startMainChain(request());
    await bodyStarted(1);
    expect(acquisitions[0]!.via).toBeUndefined();
  });

  it('starts nothing while a heavy job of the repository is active', async () => {
    await jobs.startMainChain(request());
    await bodyStarted(1);
    expect(await jobs.startMainChain(request())).toEqual({ status: 'busy' });
    expect(await rowsOfType('repo.guard-setup')).toHaveLength(1);
  });

  it('follows a running chain up ONCE for the pushes that landed meanwhile, at the newest one', async () => {
    await repos.recordDefaultBranchSha(REPO, 'sha-0');
    await jobs.startMainChain(request());
    await bodyStarted(1);
    // Three pushes while the chain is at its first link: each is remembered,
    // none starts anything.
    for (const sha of ['sha-1', 'sha-2', 'sha-3']) {
      await repos.recordDefaultBranchSha(REPO, sha);
      expect(await jobs.startMainChain(request())).toEqual({ status: 'busy' });
    }
    // The chain runs its course (setup, then the generate it chained, which
    // stops on the empty spec). It was pinned to sha-0 and the branch is at
    // sha-3, so ONE follow-up chain starts, pinned to sha-3.
    acquisitions[0]!.release();
    await bodyStarted(2);
    acquisitions[1]!.release();
    await bodyStarted(3);
    expect(await rowsOfType('repo.guard-setup')).toHaveLength(2);
    expect(acquisitions[2]!.via).toMatchObject({ commitSha: 'sha-3' });

    // The follow-up's chain is pinned to the commit the branch is at, so
    // nothing follows it — whatever commit the tree it was handed resolves to.
    acquisitions[2]!.release();
    await bodyStarted(4);
    acquisitions[3]!.release();
    await drainLane();
    expect(await rowsOfType('repo.guard-setup')).toHaveLength(2);
    expect(await new JobStore(db).listActive(ORG)).toEqual([]);
  });

  it('does not follow a CANCELLED chain up, however many pushes it missed', async () => {
    await repos.recordDefaultBranchSha(REPO, 'sha-0');
    await jobs.startMainChain(request());
    await bodyStarted(1);
    await repos.recordDefaultBranchSha(REPO, 'sha-1');
    // A disconnect cancels the chain; the body is held at its clone, so let
    // it go once the cancel has been asked for.
    const cancelled = jobs.cancelRepoJobs(REPO, ORG);
    await settle(20);
    acquisitions[0]!.release();
    expect(await cancelled).toBe('stopped');
    await drainLane();
    expect(await rowsOfType('repo.guard-setup')).toHaveLength(1);
    expect(await new JobStore(db).listActive(ORG)).toEqual([]);
  });

  it('a run pinned by its request clones that commit', async () => {
    await jobs.enqueueGuardRun({ ...request(), source: 'chain', commitSha: 'deadbeef' });
    await bodyStarted(1);
    expect(acquisitions[0]!.via).toMatchObject({ commitSha: 'deadbeef' });
  });
});
