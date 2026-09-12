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
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Runner } from 'graphile-worker';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { registerJob } from '@truecourse/jobs';
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

import { createApp } from '../../apps/dashboard/server/src/app';
import {
  createGithubConnection,
  type ContextSyncStart,
} from '../../apps/dashboard/server/src/github/index';
import {
  createRunClone,
  getRunClonesDir,
  sweepStaleRunClones,
  type GitRunner,
} from '../../apps/dashboard/server/src/services/run-clone.service';
import {
  acquireWorkTree,
  setWorkTreeProvider,
  type WorkTreeProvider,
} from '../../apps/dashboard/server/src/services/work-tree.service';
import { createServerJobs, type JobsMount } from '../../apps/dashboard/server/src/jobs/index';
import { setRepoJobsCanceller } from '../../apps/dashboard/server/src/services/repo-removal.service';
import {
  resetWorkspaceLlmBackend,
  resetWorkspaceLlmConfigStore,
  setWorkspaceLlmBackend,
  setWorkspaceLlmConfigStore,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';
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
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import type { OctokitClient } from '../../packages/github-app/src/octokit';
import { MemoryGateStore } from '../github-app/memory-store';
import { memoryContextStore } from '../helpers/memory-context-store';

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
  contextSync?: ContextSyncStart;
  lookupInstallationAccount?: (
    installationId: number,
  ) => Promise<{ accountLogin: string; accountType: string } | null>;
}

let store: MemoryGateStore;
/** The workspace's Context, so a test can plant a source and read it back. */
let contextStore: ReturnType<typeof memoryContextStore>;

function buildApp(opts: MountOptions = {}): Express {
  const github = createGithubConnection({
    store,
    octokitFor: () => octokit,
    ...opts,
  });
  if (!github) throw new Error('expected a configured GitHub connection');
  return createApp({ serveStatic: false, authVerifier: verify, github, jobs: null });
}

/** Poll until a fire-and-forget handler has landed. */
async function waitFor(done: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the handler');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
  // Connecting a repository creates its workspace Context source, so the
  // workspace store has to exist for the connect hook to do anything.
  contextStore = memoryContextStore();
  setContextStore(contextStore);
  setRegistryStore(derivedRegistry(store));
  await store.saveInstallation({
    installationId: INSTALLATION_ID,
    accountLogin: 'acme',
    accountType: 'Organization',
    workspaceOrgId: ORG,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  // The onboarding scan runs on the connecting workspace's provider — give the
  // workspace one, and answer its pre-flight probe without a network call.
  setWorkspaceLlmConfigStore({
    getConfig: async (orgId) =>
      orgId === ORG ? { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-test' } : null,
    getView: async () => null,
    save: async () => {},
  });
  setWorkspaceLlmBackend({ probe: async () => {}, driver: () => ({}) as never });
});

afterEach(() => {
  resetRegistryStore();
  resetContextStore();
  resetWorkspaceLlmConfigStore();
  resetWorkspaceLlmBackend();
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
    const app = createApp({ serveStatic: false, authVerifier: null, github: null, jobs: null });

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
    const app = buildApp({ contextSync: async () => 'queued' });
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
    const app = buildApp({ contextSync: async () => 'queued' });
    const res = await request(app)
      .post('/api/github/webhook')
      .set('X-GitHub-Event', 'installation')
      .send({ action: 'created' })
      .expect(401);

    // The gate would say "Authentication required" — this 401 is the HMAC's.
    expect(res.body.error).toBe('invalid signature');
  });

  it('puts the connect routes behind the auth gate', async () => {
    const app = buildApp({ contextSync: async () => 'queued' });
    await request(app).get('/api/github/status').expect(401);
    await request(app).get('/api/github/status').set('Cookie', `tc_session=${ORG}`).expect(200);
  });
});

// ---------------------------------------------------------------------------
// A push
// ---------------------------------------------------------------------------

/** The push GitHub delivers for a repository's default branch. */
const pushWebhook = (app: Express, repoFullName: string) => {
  const { payload, signature } = signed({
    ref: 'refs/heads/main',
    after: 'abc123',
    repository: { full_name: repoFullName, default_branch: 'main' },
    installation: { id: INSTALLATION_ID },
  });
  return request(app)
    .post('/api/github/webhook')
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', 'push')
    .set('X-Hub-Signature-256', signature)
    .send(payload);
};

describe('a push to the default branch', () => {
  it('syncs a connected repository’s source', async () => {
    const started: Array<[string, string, string]> = [];
    const app = buildApp({
      contextSync: async (orgId, sourceId, source) => {
        started.push([orgId, sourceId, source]);
        return 'queued';
      },
    });
    await linkRepo(app).expect(201);
    started.length = 0;

    await pushWebhook(app, REPO).expect(202);
    await waitFor(() => started.length > 0);
    expect(started).toEqual([[ORG, 'repo-acme-widgets', 'push']]);
  });

  // A source may read a repository Code never connected. The push still tells
  // the workspace its documents moved, through the installation's own workspace.
  it('syncs the source of a repository nothing connected', async () => {
    const started: Array<[string, string, string]> = [];
    const app = buildApp({
      contextSync: async (orgId, sourceId, source) => {
        started.push([orgId, sourceId, source]);
        return 'queued';
      },
    });
    await contextStore.createSource(ORG, {
      id: 'repo-acme-handbook',
      kind: 'repository',
      title: 'acme/handbook',
      config: { repoFullName: 'acme/handbook', installationId: INSTALLATION_ID, include: [], exclude: [], branch: 'main' },
    });

    await pushWebhook(app, 'acme/handbook').expect(202);
    await waitFor(() => started.length > 0);
    expect(started).toEqual([[ORG, 'repo-acme-handbook', 'push']]);
    // Still not connected: a push creates no link and no repository.
    expect(await store.getRepo('acme/handbook')).toBeNull();
  });

  it('does nothing for an unconnected repository with no source', async () => {
    const started: string[] = [];
    const app = buildApp({
      contextSync: async (_orgId, sourceId) => {
        started.push(sourceId);
        return 'queued';
      },
    });

    await pushWebhook(app, 'acme/unknown').expect(202);
    // Give the fire-and-forget handler the beat it would need to do something.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The work tree
// ---------------------------------------------------------------------------

describe('the work-tree provider', () => {
  it('clones through the installation it is handed, reading no link', async () => {
    buildApp();
    const reads: string[] = [];
    const real = store.getRepo.bind(store);
    store.getRepo = async (repoFullName: string) => {
      reads.push(repoFullName);
      return real(repoFullName);
    };

    // Nothing is linked, so a link lookup would refuse by name alone. Given the
    // installation the clone goes straight for its token instead, which this
    // suite's fake private key cannot mint, and that is where it fails.
    const failure = await acquireWorkTree('acme/handbook', {
      installationId: INSTALLATION_ID,
      workspaceOrgId: ORG,
    }).then(
      () => null,
      (err: unknown) => (err as Error).message,
    );
    expect(failure).not.toBeNull();
    expect(failure).not.toMatch(/not a connected repository/);
    expect(reads).toEqual([]);
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
  // Onboarding starts in Context: the repository's own documentation becomes a
  // workspace source and its SYNC is what the connect enqueues. That sync
  // chains the workspace Document scan, whose ripple starts the tests.
  it('writes the row, enqueues the context sync, and clones nothing in the request', async () => {
    const started: Array<[string, string, string]> = [];
    const app = buildApp({
      contextSync: async (orgId, sourceId, source) => {
        started.push([orgId, sourceId, source]);
        return 'queued';
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

    // The sync was pointed at the repository's own source; no clone dir exists.
    // The work happens on the queue, on the connecting workspace's provider.
    expect(started).toEqual([[ORG, 'repo-acme-widgets', 'add']]);
    expect(fs.existsSync(getRunClonesDir())).toBe(false);
  });

  // Context may add a repository's source before Code ever connects it, so
  // connecting reuses the source it finds rather than making a second one, and
  // leaves its scope (patterns, branch, account) exactly as the user set it.
  it('reuses the Context source a repository already has', async () => {
    const started: Array<[string, string, string]> = [];
    const app = buildApp({
      contextSync: async (orgId, sourceId, source) => {
        started.push([orgId, sourceId, source]);
        return 'queued';
      },
    });
    await contextStore.createSource(ORG, {
      id: 'repo-acme-widgets',
      kind: 'repository',
      title: REPO,
      config: {
        repoFullName: REPO,
        installationId: INSTALLATION_ID,
        include: ['handbook/**'],
        exclude: [],
        branch: 'trunk',
      },
    });

    await linkRepo(app).expect(201);

    expect((await contextStore.listSources(ORG)).map((s) => s.id)).toEqual(['repo-acme-widgets']);
    expect((await contextStore.listSources(ORG))[0]!.config).toEqual({
      repoFullName: REPO,
      installationId: INSTALLATION_ID,
      include: ['handbook/**'],
      exclude: [],
      branch: 'trunk',
    });
    // The repository now READS it, and the connect still starts its sync.
    expect(await contextStore.bindings(ORG, REPO)).toEqual(['repo-acme-widgets']);
    expect(started).toEqual([[ORG, 'repo-acme-widgets', 'add']]);
  });

  it('refuses to connect the same repository twice', async () => {
    let syncs = 0;
    const app = buildApp({
      contextSync: async () => {
        syncs += 1;
        return 'queued';
      },
    });

    await linkRepo(app).expect(201);
    // A second link would re-fire the whole onboarding chain on a live repo.
    await linkRepo(app).expect(409);
    expect(syncs).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Unlinking a repo
// ---------------------------------------------------------------------------

describe('disconnecting a repository', () => {
  it('drops the row and the repo’s session transcripts', async () => {
    const app = buildApp({ contextSync: async () => 'queued' });
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
    const app = buildApp({ contextSync: async () => 'queued' });
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
  const app = (): Express => buildApp({ contextSync: async () => 'queued' });

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
    const app = buildApp({ contextSync: async () => 'queued' });
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
