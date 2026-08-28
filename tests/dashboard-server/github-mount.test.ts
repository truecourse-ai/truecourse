/**
 * The GitHub App connection, mounted in the base server.
 *
 * Three things are pinned here. WHERE the routers sit: the webhook receiver
 * above the auth gate (GitHub has no session — its HMAC signature is its auth),
 * the connect API below it. WHAT CONNECTING A REPO DOES: write the link row —
 * the row IS the connection — and start the onboarding scan, which acquires
 * its own ephemeral work tree; nothing is cloned inside the request, and the
 * registry every route resolves against is a live view of the link store. And
 * WHAT AN UNCONFIGURED SERVER ANSWERS: 503 with the env vars to set, never a
 * silent 404.
 *
 * The GitHub side is faked throughout (an in-memory link store, an injected
 * work-tree provider), so nothing here reaches the network or a database. The
 * one real git assertion is on the clone ARGV of the run-clone service: the
 * token must ride an `http.*.extraheader` flag, never the URL.
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

// The scan engine. Stubbed so the link path is exercised without an LLM, an
// agent session, or a run store — and so a test can hold the scan open and
// watch the response come back anyway.
const scan = vi.hoisted(() => ({
  calls: [] as string[],
  impl: (async () => ({
    noChanges: false,
    curate: { corpus: {}, stats: {} },
  })) as (repoRoot: string, options?: { signal?: AbortSignal }) => Promise<unknown>,
}));

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return {
    ...actual,
    // The real options ride through — `signal` above all, since disconnecting a
    // repository cancels the scan holding it.
    curateInProcess: (repoRoot: string, options?: { signal?: AbortSignal }) => {
      scan.calls.push(repoRoot);
      return scan.impl(repoRoot, options);
    },
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { createGithubConnection } from '../../apps/dashboard/server/src/github/index';
import {
  createRunClone,
  getRunClonesDir,
  sweepStaleRunClones,
  type GitRunner,
} from '../../apps/dashboard/server/src/services/run-clone.service';
import {
  setWorkTreeProvider,
  type WorkTreeProvider,
} from '../../apps/dashboard/server/src/services/work-tree.service';
import {
  isSpecScanRunning,
  startOnboardingScan,
} from '../../apps/dashboard/server/src/services/onboarding-scan.service';
// Seam state must be set on the SAME module instance the server code reads, so
// these come in via the package specifiers (dist) the server itself imports —
// a source-path import here would install the stores on a parallel copy.
import {
  setRegistryStore,
  resetRegistryStore,
  slugify,
  type RegistryEntry,
  type RegistryStore,
} from '@truecourse/core/config/registry';
import {
  createSessionRun,
  sessionsDir,
  setSessionsRootResolver,
  resetSessionsRootResolver,
} from '@truecourse/core/lib/sessions-store';
import type { OctokitClient } from '../../packages/scm-github/src/octokit';
import { MemoryGateStore } from '../scm-github/memory-store';

const ORG = 'org_A';
const OTHER_ORG = 'org_B';
const INSTALLATION_ID = 42;
const REPO = 'acme/widgets';
const REPO_SLUG = slugify(REPO, []);
const WEBHOOK_SECRET = 'shhh';

const APP_ENV = {
  GITHUB_APP_ID: '1234',
  GITHUB_APP_PRIVATE_KEY: 'not-a-real-key',
  GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
  GITHUB_APP_SLUG: 'truecourse-test',
} as const;

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  // realpath: macOS /tmp is a symlink, and paths get compared resolved.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

/** A git repo standing in for a fresh ephemeral clone. */
function fakeWorkTree(): string {
  const dir = makeTmpDir('tc-worktree-');
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

/**
 * The registry as production runs it: a live view of the link store, exactly
 * what GhReposRegistryStore derives from gh_repos. Mutations are no-ops.
 */
function derivedRegistry(gate: MemoryGateStore): RegistryStore {
  const toEntry = (repoFullName: string, defaultBranch: string): RegistryEntry => ({
    slug: slugify(repoFullName, []),
    name: repoFullName,
    path: repoFullName,
    defaultBranch,
    remoteUrl: `https://github.com/${repoFullName}`,
  });
  const all = async (): Promise<RegistryEntry[]> =>
    (await gate.listRepos()).map((r) => toEntry(r.repoFullName, r.defaultBranch));
  return {
    readRegistry: all,
    pruneStaleProjects: all,
    getProjectBySlug: async (slug) => (await all()).find((e) => e.slug === slug) ?? null,
    getProjectByPath: async (p) => (await all()).find((e) => e.path === p) ?? null,
    registerProject: async (repoPath) =>
      (await all()).find((e) => e.path === repoPath) ?? {
        slug: slugify(repoPath, []),
        name: repoPath,
        path: repoPath,
      },
    unregisterProject: async () => true,
    touchProject: async () => {},
    setLastAnalyzed: async () => {},
  };
}

interface MountOptions {
  workTree?: WorkTreeProvider;
  scan?: (repoId: string, repoKey: string) => boolean;
  lookupInstallationAccount?: (
    installationId: number,
  ) => Promise<{ accountLogin: string; accountType: string } | null>;
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
  process.env.TRUECOURSE_HOME = makeTmpDir('tc-github-home-');
  Object.assign(process.env, APP_ENV);
  // The production sessions layout: transcripts keyed by repo identity under
  // the global dir, so they exist independent of any work tree.
  setSessionsRootResolver((key) =>
    path.isAbsolute(key)
      ? path.join(key, '.truecourse', 'sessions')
      : path.join(process.env.TRUECOURSE_HOME!, 'sessions', key.replace('/', '__')),
  );
});

beforeEach(async () => {
  store = new MemoryGateStore();
  setRegistryStore(derivedRegistry(store));
  await store.saveInstallation({
    installationId: INSTALLATION_ID,
    accountLogin: 'acme',
    accountType: 'Organization',
    workspaceOrgId: ORG,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  scan.calls.length = 0;
  scan.impl = async () => ({ noChanges: false, curate: { corpus: {}, stats: {} } });
});

afterEach(() => {
  resetRegistryStore();
  setWorkTreeProvider(null);
  fs.rmSync(path.join(process.env.TRUECOURSE_HOME!, 'sessions'), { recursive: true, force: true });
});

afterAll(() => {
  resetSessionsRootResolver();
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
// Naming an installation
// ---------------------------------------------------------------------------

describe('an installation the webhook never announced', () => {
  it('takes its account from the App API on the setup redirect', async () => {
    const looked: number[] = [];
    const app = buildApp({
      lookupInstallationAccount: async (installationId) => {
        looked.push(installationId);
        return { accountLogin: 'acme', accountType: 'Organization' };
      },
    });

    // No `installation` delivery for 99 — only the browser coming back from GitHub.
    await request(app)
      .get('/api/github/setup')
      .set('Cookie', `tc_session=${ORG}`)
      .query({ installation_id: '99', state: ORG })
      .expect(302);

    expect(looked).toEqual([99]);
    expect(await store.getInstallation(99)).toMatchObject({
      accountLogin: 'acme',
      accountType: 'Organization',
      workspaceOrgId: ORG,
    });
  });
});

// ---------------------------------------------------------------------------
// Linking a repo
// ---------------------------------------------------------------------------

const linkRepo = (app: Express, org = ORG) =>
  request(app)
    .post('/api/github/repos/link')
    .set('Cookie', `tc_session=${org}`)
    .send({ repoFullName: REPO, installationId: INSTALLATION_ID, defaultBranch: 'main' });

describe('linking a repository', () => {
  it('writes the row, starts the scan, and clones nothing in the request', async () => {
    const started: Array<[string, string]> = [];
    const app = buildApp({
      scan: (repoId, repoKey) => {
        started.push([repoId, repoKey]);
        return true;
      },
    });

    await linkRepo(app).expect(201);

    // The row IS the connection, and the registry is its live view.
    expect(await store.getRepo(REPO)).toMatchObject({
      repoFullName: REPO,
      workspaceOrgId: ORG,
    });
    const detail = await request(app)
      .get(`/api/repos/${REPO_SLUG}`)
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      name: REPO,
      defaultBranch: 'main',
      // The preview reads `remoteUrl` to tell a real repository from a fixture.
      remoteUrl: `https://github.com/${REPO}`,
    });

    // The scan was pointed at the repo IDENTITY; no clone dir exists.
    expect(started).toEqual([[REPO_SLUG, REPO]]);
    expect(fs.existsSync(getRunClonesDir())).toBe(false);
  });

  it('refuses to connect the same repository twice', async () => {
    let scans = 0;
    const app = buildApp({
      scan: () => {
        scans += 1;
        return true;
      },
    });

    await linkRepo(app).expect(201);
    // A second link would re-fire the onboarding scan on a live repo.
    await linkRepo(app).expect(409);
    expect(scans).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Unlinking a repo
// ---------------------------------------------------------------------------

describe('disconnecting a repository', () => {
  it('drops the row and the repo’s session transcripts', async () => {
    const app = buildApp({ scan: () => true });
    await linkRepo(app).expect(201);

    // Transcripts a scan left behind, keyed by identity.
    createSessionRun(REPO, { command: 'spec-scan', gitRef: 'abc' }).finish('completed');
    expect(fs.existsSync(sessionsDir(REPO))).toBe(true);

    await request(app)
      .delete('/api/github/repos/link')
      .query({ repoFullName: REPO })
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);

    expect(await store.getRepo(REPO)).toBeNull();
    expect(fs.existsSync(sessionsDir(REPO))).toBe(false);
  });

  it('drops the link row when the repo is disconnected from Home', async () => {
    const app = buildApp({ scan: () => true });
    await linkRepo(app).expect(201);

    await request(app)
      .delete(`/api/repos/${REPO_SLUG}`)
      .set('Cookie', `tc_session=${ORG}`)
      .expect(204);

    expect(await store.getRepo(REPO)).toBeNull();

    const status = await request(app)
      .get('/api/github/status')
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);
    expect(status.body.repos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Workspace scoping, everywhere a slug resolves
// ---------------------------------------------------------------------------

describe('a slug that belongs to another workspace', () => {
  const app = (): Express => buildApp({ scan: () => true });

  it('404s the repo detail route — not 403, which would confirm it exists', async () => {
    const server = app();
    await linkRepo(server).expect(201);

    await request(server)
      .get(`/api/repos/${REPO_SLUG}`)
      .set('Cookie', `tc_session=${OTHER_ORG}`)
      .expect(404);
    await request(server)
      .get(`/api/repos/${REPO_SLUG}`)
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);
  });

  it('404s a project-scoped router behind the resolver', async () => {
    const server = app();
    await linkRepo(server).expect(201);

    await request(server)
      .get(`/api/repos/${REPO_SLUG}/sessions/runs`)
      .set('Cookie', `tc_session=${OTHER_ORG}`)
      .expect(404);
    await request(server)
      .get(`/api/repos/${REPO_SLUG}/sessions/runs`)
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);
  });

  it('404s the per-repo config route', async () => {
    const server = app();
    await linkRepo(server).expect(201);

    await request(server)
      .get(`/api/repos/${REPO_SLUG}/config`)
      .set('Cookie', `tc_session=${OTHER_ORG}`)
      .expect(404);
    await request(server)
      .get(`/api/repos/${REPO_SLUG}/config`)
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);
  });

  it('refuses to DELETE it — the link survives', async () => {
    const server = app();
    await linkRepo(server).expect(201);

    await request(server)
      .delete(`/api/repos/${REPO_SLUG}`)
      .set('Cookie', `tc_session=${OTHER_ORG}`)
      .expect(404);

    expect(await store.getRepo(REPO)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Workspace scoping of the repo list
// ---------------------------------------------------------------------------

describe('GET /api/repos with a link store', () => {
  it("hides another workspace's connected repository", async () => {
    const app = buildApp({ scan: () => true });
    await linkRepo(app).expect(201);

    const mine = await request(app)
      .get('/api/repos')
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);
    expect((mine.body as Array<{ name: string }>).map((r) => r.name)).toEqual([REPO]);

    const theirs = await request(app)
      .get('/api/repos')
      .set('Cookie', `tc_session=${OTHER_ORG}`)
      .expect(200);
    expect(theirs.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The run-clone argv
// ---------------------------------------------------------------------------

describe('createRunClone', () => {
  /** Records the argv; the clone target already exists (mkdtemp creates it). */
  function recordingGit(): { calls: Array<{ args: string[]; cwd?: string }>; run: GitRunner } {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const run: GitRunner = async (args, cwd) => {
      calls.push({ args, cwd });
    };
    return { calls, run };
  }

  it('carries the token in an extraheader flag, never in the URL', async () => {
    const { calls, run } = recordingGit();

    const clone = await createRunClone(REPO, 'ghs_secret_token', {
      workspaceOrgId: ORG,
      defaultBranch: 'main',
      run,
    });

    // A fresh per-run dir under the workspace's own run-clones dir.
    expect(clone.dir.startsWith(path.join(getRunClonesDir(), 'org_a') + path.sep)).toBe(true);
    expect(path.basename(clone.dir).startsWith('tc-run-')).toBe(true);

    const cloneArgs = calls[0]!.args;
    const basic = Buffer.from('x-access-token:ghs_secret_token').toString('base64');
    const header = `http.https://github.com/.extraheader=Authorization: Basic ${basic}`;
    // The credential appears exactly once, as the value of a `-c` flag.
    expect(cloneArgs.filter((a) => a.includes(basic))).toEqual([header]);
    expect(cloneArgs[cloneArgs.indexOf(header) - 1]).toBe('-c');
    // The remote is the bare https URL, pinned to the default branch.
    expect(cloneArgs).toContain(`https://github.com/${REPO}.git`);
    expect(cloneArgs).toContain('--depth');
    expect(cloneArgs).toContain('--branch');
    expect(cloneArgs[cloneArgs.indexOf('--branch') + 1]).toBe('main');

    clone.dispose();
    expect(fs.existsSync(clone.dir)).toBe(false);
  });

  it('unsets the persisted auth header, tolerating an already-absent key', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const run: GitRunner = async (args, cwd) => {
      calls.push({ args, cwd });
      // git exits non-zero when the key is absent — that must not throw away
      // a finished multi-minute clone.
      if (args[0] === 'config') throw new Error('exit 5');
    };

    const clone = await createRunClone(REPO, 'ghs_secret_token', { workspaceOrgId: ORG, run });

    expect(calls[1]!.args).toEqual([
      'config',
      '--unset-all',
      'http.https://github.com/.extraheader',
    ]);
    expect(calls[1]!.cwd).toBe(clone.dir);
    clone.dispose();
  });

  it('removes the dir and reports 502 with git’s last stderr line on failure', async () => {
    const run: GitRunner = async (args) => {
      if (args[0] === 'clone') {
        const err = new Error('git failed') as Error & { stderr: string };
        err.stderr = 'Cloning...\nfatal: repository not found\n';
        throw err;
      }
    };

    await expect(
      createRunClone(REPO, 'ghs_secret_token', { workspaceOrgId: ORG, run }),
    ).rejects.toThrow(/repository not found/);
    // No half-clone left behind.
    const tenantRoot = path.join(getRunClonesDir(), 'org_a');
    expect(fs.existsSync(tenantRoot) ? fs.readdirSync(tenantRoot) : []).toEqual([]);
  });

  it('sweeps stale run clones and keeps fresh ones', async () => {
    const { run } = recordingGit();
    const fresh = await createRunClone(REPO, 't', { workspaceOrgId: ORG, run });
    const stale = await createRunClone(REPO, 't', { workspaceOrgId: OTHER_ORG, run });
    const oldTime = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(stale.dir, oldTime, oldTime);

    expect(sweepStaleRunClones()).toBe(1);
    expect(fs.existsSync(fresh.dir)).toBe(true);
    expect(fs.existsSync(stale.dir)).toBe(false);
    fresh.dispose();
  });
});

// ---------------------------------------------------------------------------
// The onboarding scan (the real seam, with the scan engine stubbed)
// ---------------------------------------------------------------------------

interface Deferred {
  promise: Promise<unknown>;
  resolve: () => void;
}

/** A scan the test holds open, so "the response did not wait" is observable. */
function heldScan(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<unknown>((res) => {
    resolve = () => res({ noChanges: false, curate: { corpus: {}, stats: {} } });
  });
  // Nothing awaits this promise but the service; a rejection there is handled.
  promise.catch(() => {});
  return { promise, resolve };
}

const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Wait for a background effect, rather than guessing how long it will take. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await settle(10);
}

describe('connecting a repository starts its spec scan', () => {
  const held: Deferred[] = [];
  const disposed: string[] = [];
  let workTreeDir: string;

  /** The mount with its REAL scan seam — only the work tree and LLM are faked. */
  function appWithRealScan(): Express {
    workTreeDir = fakeWorkTree();
    return buildApp({
      workTree: async () => ({
        dir: workTreeDir,
        dispose: () => disposed.push(workTreeDir),
      }),
    });
  }

  afterEach(async () => {
    // Release anything still held so the service's in-flight set clears, and
    // only then drop the dispose log — the release itself disposes a tree.
    for (const d of held.splice(0)) d.resolve();
    await settle();
    disposed.length = 0;
  });

  it('runs the scan on the acquired work tree, in the background of the 201', async () => {
    await linkRepo(appWithRealScan()).expect(201);

    await until(() => scan.calls.length > 0);
    expect(scan.calls).toEqual([workTreeDir]);
    // The tree is disposed once the scan settles.
    await until(() => disposed.length > 0);
    expect(disposed).toEqual([workTreeDir]);
  });

  it('answers before the scan finishes — a held scan does not hold the response', async () => {
    const pending = heldScan();
    held.push(pending);
    scan.impl = () => pending.promise;

    // Only passes if the link never awaits the scan: this one never settles.
    await linkRepo(appWithRealScan()).expect(201);

    await until(() => scan.calls.length > 0);
    expect(scan.calls).toEqual([workTreeDir]);
    // The in-flight guard is keyed by identity, and the tree is still live.
    expect(isSpecScanRunning(REPO)).toBe(true);
    expect(disposed).toEqual([]);
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

      await until(() => scan.calls.length > 0);
      await until(() => !isSpecScanRunning(REPO));
      expect(scan.calls).toHaveLength(1);
      expect(unhandled).toEqual([]);
      // The failure released the repo AND disposed its tree.
      expect(isSpecScanRunning(REPO)).toBe(false);
      expect(disposed).toEqual([workTreeDir]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('does not start a second scan while one is running', async () => {
    const tree = fakeWorkTree();
    setWorkTreeProvider(async () => ({ dir: tree, dispose: () => {} }));
    const pending = heldScan();
    held.push(pending);
    scan.impl = () => pending.promise;

    expect(startOnboardingScan('twice', 'acme/twice')).toBe(true);
    expect(startOnboardingScan('twice', 'acme/twice')).toBe(false);

    await until(() => scan.calls.length > 0);
    expect(scan.calls).toEqual([tree]);
  });

  it('unlinking mid-scan cancels the scan and disposes its work tree', async () => {
    // A scan that ends only when it is cancelled: without cancellation the
    // unlink hook has nothing to do but refuse.
    let reached = false;
    scan.impl = (_repoRoot, options) =>
      new Promise((_resolve, reject) => {
        reached = true;
        const stop = (): void => reject(new Error('the spec scan was cancelled'));
        if (options?.signal?.aborted) stop();
        else options?.signal?.addEventListener('abort', stop, { once: true });
      });

    const app = appWithRealScan();
    await linkRepo(app).expect(201);
    await until(() => reached);
    expect(isSpecScanRunning(REPO)).toBe(true);

    await request(app)
      .delete('/api/github/repos/link')
      .query({ repoFullName: REPO })
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);

    expect(isSpecScanRunning(REPO)).toBe(false);
    expect(await store.getRepo(REPO)).toBeNull();
    expect(disposed).toEqual([workTreeDir]);
  });

  it('sees a scan another process started, through the sessions store', async () => {
    expect(isSpecScanRunning('acme/elsewhere')).toBe(false);

    // A run record left `running` by a live process — what a scan owned by an
    // earlier server process looks like from here.
    createSessionRun('acme/elsewhere', { command: 'spec-scan', gitRef: 'HEAD' });

    expect(isSpecScanRunning('acme/elsewhere')).toBe(true);
    expect(startOnboardingScan('elsewhere', 'acme/elsewhere')).toBe(false);
    await settle();
    expect(scan.calls).toEqual([]);
  });
});
