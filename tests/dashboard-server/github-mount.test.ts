/**
 * The GitHub App connection, mounted in the base server.
 *
 * Three things are pinned here. WHERE the routers sit: the webhook receiver
 * above the auth gate (GitHub has no session — its HMAC signature is its auth),
 * the connect API below it. WHAT CONNECTING A REPO DOES: clone it with an
 * installation token, register the clone as a project, start its onboarding
 * scan — and the reverse on disconnect. And WHAT AN UNCONFIGURED SERVER
 * ANSWERS: 503 with the env vars to set, never a silent 404.
 *
 * The GitHub side is faked throughout (an in-memory link store, an injected
 * clone), so nothing here reaches the network or a database. The one real git
 * assertion is on the clone ARGV: the token must ride an `http.*.extraheader`
 * flag, never the URL.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import type { AuthResult, AuthVerifier } from '@truecourse/shared';

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

// The onboarding scan's entry point. Stubbed so the link path is exercised
// without an LLM, an agent session, or a run store — and so a test can hold the
// scan open and watch the response come back anyway.
const scan = vi.hoisted(() => ({
  calls: [] as string[],
  impl: (async () => ({})) as (repoRoot: string) => Promise<unknown>,
}));

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return {
    ...actual,
    curateInProcess: (repoRoot: string) => {
      scan.calls.push(repoRoot);
      return scan.impl(repoRoot);
    },
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { createGithubConnection } from '../../apps/dashboard/server/src/github/index';
import {
  cloneGithubRepo,
  getClonesDir,
  type GitRunner,
} from '../../apps/dashboard/server/src/services/repo-clone.service';
import {
  isSpecScanRunning,
  startOnboardingScan,
} from '../../apps/dashboard/server/src/services/onboarding-scan.service';
import { readRegistry, unregisterProject } from '../../packages/core/src/config/registry';
import { createSessionRun } from '../../packages/core/src/lib/sessions-store';
import type {
  OctokitClient,
} from '../../packages/scm-github/src/octokit';
import type { RepoLinkRecord } from '../../packages/scm-github/src/store/types';
import { MemoryGateStore } from '../scm-github/memory-store';

const ORG = 'org_A';
const OTHER_ORG = 'org_B';
const INSTALLATION_ID = 42;
const REPO = 'acme/widgets';
const WEBHOOK_SECRET = 'shhh';

const APP_ENV = {
  GITHUB_APP_ID: '1234',
  GITHUB_APP_PRIVATE_KEY: 'not-a-real-key',
  GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
  GITHUB_APP_SLUG: 'truecourse-test',
} as const;

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  // realpath: macOS /tmp is a symlink, and the registry stores resolved paths.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

/** A git repo where a clone would land — what the injected clone produces. */
function fakeClonedRepo(repoFullName: string): string {
  const dir = path.join(getClonesDir(), repoFullName.replace('/', '__'));
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--initial-branch=main');
  // The suite hides the developer's global git config, so identity is per-repo.
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), '# widgets\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'one');
  return dir;
}

const octokit = { id: 'octokit-for-42' } as unknown as OctokitClient;

/** A session verifier: `tc_session=<org>` resolves a user in that organization. */
const verify: AuthVerifier = async (cookieHeader) => {
  const match = /tc_session=([^;]+)/.exec(cookieHeader ?? '');
  if (!match) return null;
  const organizationId = match[1] as string;
  return { user: { id: `u_${organizationId}`, email: 'u@acme.test', organizationId } } satisfies AuthResult;
};

interface MountOptions {
  clone?: (link: RepoLinkRecord) => Promise<string>;
  scan?: (repoId: string, repoPath: string) => boolean;
}

let store: MemoryGateStore;

function buildApp(opts: MountOptions = {}): Express {
  const github = createGithubConnection({
    store,
    octokitFor: () => octokit,
    ...opts,
  });
  if (!github) throw new Error('expected a configured GitHub connection');
  return createApp({ serveStatic: false, authVerifier: verify, github });
}

function signed(body: unknown): { payload: string; signature: string } {
  const payload = JSON.stringify(body);
  const signature =
    'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return { payload, signature };
}

beforeAll(() => {
  // The registry and the managed clones root both hang off TRUECOURSE_HOME;
  // point them at a throwaway dir. Both are read lazily, per call.
  process.env.TRUECOURSE_HOME = makeTmpDir('tc-github-home-');
  Object.assign(process.env, APP_ENV);
});

beforeEach(async () => {
  store = new MemoryGateStore();
  await store.saveInstallation({
    installationId: INSTALLATION_ID,
    accountLogin: 'acme',
    accountType: 'Organization',
    workspaceOrgId: ORG,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  scan.calls.length = 0;
  scan.impl = async () => ({});
});

afterEach(async () => {
  for (const entry of await readRegistry()) await unregisterProject(entry.slug);
  fs.rmSync(getClonesDir(), { recursive: true, force: true });
});

afterAll(() => {
  for (const key of Object.keys(APP_ENV)) delete process.env[key];
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Not configured
// ---------------------------------------------------------------------------

describe('a server with no GitHub App configured', () => {
  it('builds no connection when GITHUB_APP_* is unset', () => {
    const saved = { ...process.env };
    for (const key of Object.keys(APP_ENV)) delete process.env[key];
    try {
      expect(createGithubConnection()).toBeNull();
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('answers every /api/github route with an actionable 503', async () => {
    const app = createApp({ serveStatic: false, authVerifier: null, github: null });

    const status = await request(app).get('/api/github/status').expect(503);
    expect(status.body.error).toMatch(/GITHUB_APP_ID/);
    expect(status.body.error).toMatch(/GITHUB_APP_PRIVATE_KEY/);
    expect(status.body.error).toMatch(/GITHUB_APP_WEBHOOK_SECRET/);
    expect(status.body.error).toMatch(/GITHUB_APP_SLUG/);

    // The webhook too: an unconfigured server tells GitHub why, rather than
    // 404ing a path that looks like it should exist.
    await request(app).post('/api/github/webhook').send({}).expect(503);
  });
});

// ---------------------------------------------------------------------------
// Where the routers sit
// ---------------------------------------------------------------------------

describe('mount order', () => {
  it('takes a signed webhook with no session cookie', async () => {
    const app = buildApp({ scan: () => true });
    const { payload, signature } = signed({
      action: 'created',
      installation: { id: 77, account: { login: 'acme', type: 'Organization' } },
    });

    await request(app)
      .post('/api/github/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signature)
      .send(payload)
      .expect(202);

    expect(await store.getInstallation(77)).not.toBeNull();
  });

  it('rejects an unsigned webhook on the signature, not the gate', async () => {
    const app = buildApp({ scan: () => true });
    const res = await request(app)
      .post('/api/github/webhook')
      .set('X-GitHub-Event', 'installation')
      .send({ action: 'created' })
      .expect(401);

    // The gate would say "Authentication required" — this 401 is the HMAC's.
    expect(res.body.error).toBe('invalid signature');
  });

  it('puts the connect routes behind the auth gate', async () => {
    const app = buildApp({ scan: () => true });
    await request(app).get('/api/github/status').expect(401);
    await request(app).get('/api/github/status').set('Cookie', `tc_session=${ORG}`).expect(200);
  });
});

// ---------------------------------------------------------------------------
// Linking a repo
// ---------------------------------------------------------------------------

describe('linking a repository', () => {
  it('clones it, registers the clone, and starts its onboarding scan', async () => {
    const cloned: RepoLinkRecord[] = [];
    const started: Array<[string, string]> = [];
    const app = buildApp({
      clone: async (link) => {
        cloned.push(link);
        return fakeClonedRepo(link.repoFullName);
      },
      scan: (repoId, repoPath) => {
        started.push([repoId, repoPath]);
        return true;
      },
    });

    await request(app)
      .post('/api/github/repos/link')
      .set('Cookie', `tc_session=${ORG}`)
      .send({ repoFullName: REPO, installationId: INSTALLATION_ID, defaultBranch: 'main' })
      .expect(201);

    expect(cloned).toHaveLength(1);
    expect(cloned[0]).toMatchObject({ repoFullName: REPO, installationId: INSTALLATION_ID });

    const registry = await readRegistry();
    expect(registry).toHaveLength(1);
    expect(registry[0]).toMatchObject({
      name: REPO,
      path: path.join(getClonesDir(), 'acme__widgets'),
      // The preview reads `remoteUrl` to tell a real repository from a fixture.
      remoteUrl: `https://github.com/${REPO}`,
    });

    expect(started).toEqual([[registry[0]!.slug, registry[0]!.path]]);
  });

  it('still connects the repo when the clone fails', async () => {
    const app = buildApp({
      clone: async () => {
        throw new Error('github unreachable');
      },
      scan: () => true,
    });

    await request(app)
      .post('/api/github/repos/link')
      .set('Cookie', `tc_session=${ORG}`)
      .send({ repoFullName: REPO, installationId: INSTALLATION_ID, defaultBranch: 'main' })
      .expect(201);

    expect(await store.getRepo(REPO)).not.toBeNull();
    expect(await readRegistry()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unlinking a repo
// ---------------------------------------------------------------------------

describe('disconnecting a repository', () => {
  it('unregisters the project and deletes the managed clone', async () => {
    const app = buildApp({
      clone: async (link) => fakeClonedRepo(link.repoFullName),
      scan: () => true,
    });
    await request(app)
      .post('/api/github/repos/link')
      .set('Cookie', `tc_session=${ORG}`)
      .send({ repoFullName: REPO, installationId: INSTALLATION_ID, defaultBranch: 'main' })
      .expect(201);
    const clone = (await readRegistry())[0]!.path;
    expect(fs.existsSync(clone)).toBe(true);

    await request(app)
      .delete('/api/github/repos/link')
      .query({ repoFullName: REPO })
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);

    expect(await store.getRepo(REPO)).toBeNull();
    expect(await readRegistry()).toHaveLength(0);
    expect(fs.existsSync(clone)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Workspace scoping of the repo list
// ---------------------------------------------------------------------------

describe('GET /api/repos with a link store', () => {
  it("hides another workspace's connected repository, and no one's local repos", async () => {
    const app = buildApp({
      clone: async (link) => fakeClonedRepo(link.repoFullName),
      scan: () => true,
    });
    await request(app)
      .post('/api/github/repos/link')
      .set('Cookie', `tc_session=${ORG}`)
      .send({ repoFullName: REPO, installationId: INSTALLATION_ID, defaultBranch: 'main' })
      .expect(201);

    // A repo registered by local path has no link row and therefore no owner.
    const local = makeTmpDir('tc-github-local-');
    await request(app)
      .post('/api/repos')
      .set('Cookie', `tc_session=${OTHER_ORG}`)
      .send({ path: local })
      .expect(201);

    const mine = await request(app)
      .get('/api/repos')
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);
    expect((mine.body as Array<{ name: string }>).map((r) => r.name).sort()).toEqual(
      [REPO, path.basename(local)].sort(),
    );

    const theirs = await request(app)
      .get('/api/repos')
      .set('Cookie', `tc_session=${OTHER_ORG}`)
      .expect(200);
    expect((theirs.body as Array<{ name: string }>).map((r) => r.name)).toEqual([
      path.basename(local),
    ]);
  });
});

// ---------------------------------------------------------------------------
// The clone argv
// ---------------------------------------------------------------------------

describe('cloneGithubRepo', () => {
  /** Records the argv and materializes whatever directory the clone targets. */
  function recordingGit(): { calls: Array<{ args: string[]; cwd?: string }>; run: GitRunner } {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const run: GitRunner = async (args, cwd) => {
      calls.push({ args, cwd });
      if (args.includes('clone')) fs.mkdirSync(args[args.length - 1] as string, { recursive: true });
    };
    return { calls, run };
  }

  it('carries the token in an extraheader flag, never in the URL', async () => {
    const { calls, run } = recordingGit();

    const target = await cloneGithubRepo(REPO, 'ghs_secret_token', run);

    expect(target).toBe(path.join(getClonesDir(), 'acme__widgets'));
    expect(fs.existsSync(target)).toBe(true);

    const cloneArgs = calls[0]!.args;
    const basic = Buffer.from('x-access-token:ghs_secret_token').toString('base64');
    const header = `http.https://github.com/.extraheader=Authorization: Basic ${basic}`;
    // The credential appears exactly once, as the value of a `-c` flag.
    expect(cloneArgs.filter((a) => a.includes(basic))).toEqual([header]);
    expect(cloneArgs[cloneArgs.indexOf(header) - 1]).toBe('-c');
    // The remote is the bare https URL.
    expect(cloneArgs).toContain(`https://github.com/${REPO}.git`);
    expect(cloneArgs).toContain('--depth');
  });

  it('unsets the persisted auth header before the clone is published', async () => {
    const { calls, run } = recordingGit();

    await cloneGithubRepo(REPO, 'ghs_secret_token', run);

    const unset = calls[1]!;
    expect(unset.args).toEqual([
      'config',
      '--unset-all',
      'http.https://github.com/.extraheader',
    ]);
    // Run in the temp clone, i.e. before it is renamed into place.
    expect(unset.cwd).toBe(calls[0]!.args[calls[0]!.args.length - 1]);
  });
});

// ---------------------------------------------------------------------------
// The onboarding scan (the real seam, with the scan entry stubbed)
// ---------------------------------------------------------------------------

interface Deferred {
  promise: Promise<unknown>;
  resolve: () => void;
}

/** A scan the test holds open, so "the response did not wait" is observable. */
function heldScan(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<unknown>((res) => {
    resolve = () => res({});
  });
  // Nothing awaits this promise but the service; a rejection there is handled.
  promise.catch(() => {});
  return { promise, resolve };
}

const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Wait for a background effect, rather than guessing how long git will take. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await settle(10);
}

describe('connecting a repository starts its spec scan', () => {
  const held: Deferred[] = [];

  /** The mount with its REAL scan seam — only the clone and the LLM are faked. */
  const appWithRealScan = (): Express =>
    buildApp({ clone: async (link) => fakeClonedRepo(link.repoFullName) });

  const linkRepo = (app: Express) =>
    request(app)
      .post('/api/github/repos/link')
      .set('Cookie', `tc_session=${ORG}`)
      .send({ repoFullName: REPO, installationId: INSTALLATION_ID, defaultBranch: 'main' });

  afterEach(async () => {
    // Release anything still held so the service's in-flight set clears.
    for (const d of held.splice(0)) d.resolve();
    await settle();
  });

  it('runs the scan on the clone, in the background of the 201', async () => {
    await linkRepo(appWithRealScan()).expect(201);

    await until(() => scan.calls.length > 0);
    expect(scan.calls).toEqual([path.join(getClonesDir(), 'acme__widgets')]);
  });

  it('answers before the scan finishes — a held scan does not hold the response', async () => {
    const pending = heldScan();
    held.push(pending);
    scan.impl = () => pending.promise;

    // Only passes if the link never awaits the scan: this one never settles.
    await linkRepo(appWithRealScan()).expect(201);

    const clone = path.join(getClonesDir(), 'acme__widgets');
    await until(() => scan.calls.length > 0);
    expect(scan.calls).toEqual([clone]);
    expect(isSpecScanRunning(clone)).toBe(true);
  });

  it('a scan that fails leaves the link response alone and rejects nothing', async () => {
    scan.impl = () => Promise.reject(new Error('no LLM transport configured'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      await linkRepo(appWithRealScan()).expect(201);

      const clone = path.join(getClonesDir(), 'acme__widgets');
      await until(() => scan.calls.length > 0);
      await until(() => !isSpecScanRunning(clone));
      expect(scan.calls).toHaveLength(1);
      expect(unhandled).toEqual([]);
      // The failure released the repo: a later scan is not blocked by it.
      expect(isSpecScanRunning(clone)).toBe(false);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('does not start a second scan while one is running', async () => {
    const repo = fakeClonedRepo('acme/twice');
    const pending = heldScan();
    held.push(pending);
    scan.impl = () => pending.promise;

    expect(startOnboardingScan('twice', repo)).toBe(true);
    expect(startOnboardingScan('twice', repo)).toBe(false);

    await until(() => scan.calls.length > 0);
    expect(scan.calls).toEqual([repo]);
  });

  it('sees a scan another process started, through the sessions store', async () => {
    const repo = fakeClonedRepo('acme/elsewhere');
    expect(isSpecScanRunning(repo)).toBe(false);

    // A run record left `running` by a live process — what a CLI `spec scan` in
    // the same clone looks like from here.
    createSessionRun(repo, { command: 'spec-scan', gitRef: 'HEAD' });

    expect(isSpecScanRunning(repo)).toBe(true);
    expect(startOnboardingScan('elsewhere', repo)).toBe(false);
    await settle();
    expect(scan.calls).toEqual([]);
  });
});
