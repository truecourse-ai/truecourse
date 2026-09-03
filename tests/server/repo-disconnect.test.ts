/**
 * Disconnecting a repository (`DELETE /api/repos/:id`).
 *
 * There is no working copy to clean up — durable state lives in the stores and
 * runs clone ephemerally — so what disconnect owns is the repository's IN-FLIGHT
 * JOBS: one running in this process is aborted (the disconnect IS the answer to
 * whether its work is still wanted), one still queued is settled cancelled so
 * the chain never starts, and one claimed by another replica blocks the
 * disconnect because it is not ours to stop. The GitHub-unlink half lives in
 * tests/dashboard-server/github-mount.test.ts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Runner } from 'graphile-worker';

// app.ts pulls the analyses router, which imports the socket-handlers module;
// stub it so nothing tries to open a real socket (same shape as the other
// route suites).
vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  class NoopTracker {
    start() {}
    done() {}
    error() {}
    detail() {}
  }
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    createSocketTracker: () => new NoopTracker(),
    createSocketSpecTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
    createSocketStashConfirmHandler: () => () => Promise.resolve('stash'),
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
  };
});

import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { JobStore } from '@truecourse/data-store';
import { registerJob } from '@truecourse/jobs';
import type { LlmTransport } from '@truecourse/shared/llm';
import { createTestApp, TEST_ORG } from '../helpers/test-app';
import { readRegistry, registerProject, unregisterProject } from '@truecourse/core/config/registry';
import {
  createServerJobs,
  type JobsMount,
} from '../../apps/dashboard/server/src/jobs/index';
import { setRepoJobsCanceller } from '../../apps/dashboard/server/src/services/repo-removal.service';
import type { WorkspaceLlm } from '../../apps/dashboard/server/src/services/workspace-llm.service';
import { forbiddenDriver } from '../core/spec-scan-session-stub';

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  // realpath: macOS /tmp is a symlink, and the registry stores resolved paths.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

/** A git repo standing in for the scan's work tree. */
function makeGitRepo(prefix: string): string {
  const repo = makeTmpDir(prefix);
  git(repo, 'init', '--initial-branch=main');
  // The suite hides the developer's global git config, so identity is per-repo.
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(repo, 'README.md'), '# one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'one');
  return repo;
}

const settle = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await settle(10);
}

const testLlm: WorkspaceLlm = {
  mode: 'api',
  driver: () => forbiddenDriver('no session runs in this suite'),
  transport: (async () => '{}') as LlmTransport,
};

let app: Express;
let pg: PGlite;
let db: Db;
let jobs: JobsMount;
let running: Promise<void>[];
/** The scan body's engine — a test replaces it to hold a job open. */
let scanImpl: (options: { signal?: AbortSignal }) => Promise<unknown>;
/** Whether the fake worker actually runs a body, or leaves the row queued. */
let claimJobs: boolean;

beforeAll(async () => {
  // The registry hangs off TRUECOURSE_HOME; point it at a throwaway dir.
  process.env.TRUECOURSE_HOME = makeTmpDir('tc-disconnect-home-');
  app = createTestApp();
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
});

beforeEach(async () => {
  running = [];
  claimJobs = true;
  scanImpl = async () => ({ curate: { corpus: { areas: [] }, decisions: {} } });
  jobs = createServerJobs({
    db,
    connectionString: 'postgres://unused',
    hub: { start: async () => {}, stop: async () => {}, subscribe: () => () => {} },
    startWorker: async ({ rt, tasks }) => {
      const handlers = new Map(tasks.map((t) => [t.type, registerJob(rt, t)] as const));
      return {
        addJob: async (name: string, payload: unknown) => {
          const handler = handlers.get(name);
          if (claimJobs && handler) running.push(handler(payload, {}).catch(() => undefined));
        },
        stop: async () => {},
      } as unknown as Runner;
    },
    scan: {
      startLlm: async () => testLlm,
      runScan: (_repoKey, options) =>
        scanImpl(options ?? {}) as ReturnType<NonNullable<typeof scanImpl>>,
    },
  });
  await jobs.start();
  setRepoJobsCanceller(jobs.cancelRepoJobs);
});

afterEach(async () => {
  setRepoJobsCanceller(null);
  await Promise.all(running);
  await jobs.stop();
  for (const entry of await readRegistry()) await unregisterProject(entry.slug);
});

afterAll(async () => {
  await pg.close();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/repos/connect', () => {
  it('is gone — a repository arrives through the GitHub App, not a pasted URL', async () => {
    await request(app)
      .post('/api/repos/connect')
      .send({ url: 'https://github.com/acme/widgets' })
      .expect(404);

    expect(await readRegistry()).toHaveLength(0);
  });
});

describe('DELETE /api/repos/:id', () => {
  it('cancels the job THIS process is running and disconnects anyway', async () => {
    const local = makeGitRepo('tc-disconnect-scanning-');
    const entry = await registerProject(local);

    // A scan that ends only when it is cancelled — the disconnect's job.
    let reached = false;
    scanImpl = (options) =>
      new Promise((_resolve, reject) => {
        reached = true;
        const stop = (): void => reject(new Error('the spec scan was cancelled'));
        if (options.signal?.aborted) stop();
        else options.signal?.addEventListener('abort', stop, { once: true });
      });

    const queued = await jobs.enqueueScan({
      repoId: entry.slug,
      repoFullName: local,
      workspaceOrgId: TEST_ORG,
      source: 'manual',
    });
    if (queued.status !== 'queued') throw new Error('the scan was not queued');
    await until(() => reached);

    // Disconnecting IS the answer to "is this work still wanted": it is not.
    await request(app).delete(`/api/repos/${entry.slug}`).expect(204);

    expect((await new JobStore(db).get(queued.jobId))?.status).toBe('cancelled');
    // The source tree is not the server's to delete.
    expect(fs.existsSync(local)).toBe(true);
    expect(await readRegistry()).toHaveLength(0);
  });

  it('cancels a job that is still queued, so its body never runs', async () => {
    const local = makeGitRepo('tc-disconnect-queued-');
    const entry = await registerProject(local);
    // Nothing claims the row: what a job waiting for a free worker looks like.
    claimJobs = false;
    const queued = await jobs.enqueueScan({
      repoId: entry.slug,
      repoFullName: local,
      workspaceOrgId: TEST_ORG,
      source: 'connect',
    });
    if (queued.status !== 'queued') throw new Error('the scan was not queued');

    await request(app).delete(`/api/repos/${entry.slug}`).expect(204);

    expect((await new JobStore(db).get(queued.jobId))?.status).toBe('cancelled');
  });

  it('refuses while ANOTHER process is running the repo’s job — it is not ours to stop', async () => {
    const local = makeGitRepo('tc-disconnect-foreign-');
    const entry = await registerProject(local);
    // A row claimed by another replica: `running`, but absent from this
    // process's cancel registry, so nothing here can abort it.
    const store = new JobStore(db);
    const row = await store.create({
      org: TEST_ORG,
      type: 'repo.scan',
      key: `repo.scan:${local}`,
      payload: {},
    });
    await store.markRunning(row.id);

    const refused = await request(app).delete(`/api/repos/${entry.slug}`).expect(409);
    expect(refused.body.error).toMatch(/another process/i);
    expect((await readRegistry()).map((e) => e.slug)).toEqual([entry.slug]);
    expect((await store.get(row.id))?.status).toBe('running');
  });
});
