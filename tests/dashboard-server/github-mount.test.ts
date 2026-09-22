/**
 * The GitHub App connection, mounted in the base server.
 *
 * Three things are pinned here. WHERE the routers sit: the webhook receiver
 * above the auth gate (GitHub has no session — its HMAC signature is its auth),
 * the connect API below it. WHAT CONNECTING A REPO DOES: write the link row
 * (the row IS the connection) and start the repository's setup, which acquires
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

// The routers import the socket-handlers module; stub it so nothing tries to
// open a real socket (same shape as the other route suites).
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
    createSocketSpecTracker: () => new NoopTracker(),
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
  };
});

// Connecting and disconnecting are reported from the link store; the analytics
// module's one capture is a spy, so the calls are asserted and nothing is sent.
vi.mock('../../apps/dashboard/server/src/observability/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../apps/dashboard/server/src/observability/posthog')>()),
  captureAction: vi.fn(),
}));

import { createApp } from '../../apps/dashboard/server/src/app';
import {
  captureAction,
  EVENTS,
} from '../../apps/dashboard/server/src/observability/posthog';
import { observeRepositories } from '../../apps/dashboard/server/src/observability/repositories';
import {
  createGithubConnection,
  type ContextSyncStart,
  type SetupStart,
} from '../../apps/dashboard/server/src/github/index';
import {
  createRunClone,
  getRunClonesDir,
  sweepRunClones,
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
import type { RepositoryRecord } from '@truecourse/shared';
import { createStoredSessionRun, sessionsDir } from '@truecourse/core/lib/sessions-store';
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs';
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import { installMemorySpecStore, resetSpecStore } from '../helpers/memory-spec-store';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import type { OctokitClient } from '../../packages/github-app/src/octokit';
import type { UserInstallation } from '../../packages/github-app/src/oauth';
import { signConnectState } from '../../packages/github-app/src/connect-state';
import { MemoryInstallationStore, seedInstallation } from '../github-app/memory-store';
import { memoryContextStore } from '../helpers/memory-context-store';
import {
  installDescribedWorkspaces,
  resetWorkspaceProfiles,
} from '../helpers/workspace-profile';

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
  GITHUB_APP_CLIENT_ID: 'Iv1.test',
  GITHUB_APP_CLIENT_SECRET: 'client-shh',
  TRUECOURSE_SECRET_KEY: 'test-secret-key-for-connect-state-signing',
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
 * The registry as production runs it: a live view of the repositories, exactly
 * what RepositoriesRegistryStore reads off them, scoped to one workspace.
 */
function derivedRegistry(gate: MemoryInstallationStore): RegistryStore {
  const toEntry = (r: RepositoryRecord): RegistryEntry => ({
    slug: r.slug,
    name: r.repoFullName,
    path: r.repoFullName,
    provider: 'github',
    ...(r.defaultBranch ? { defaultBranch: r.defaultBranch } : {}),
  });
  const mine = async (org: string): Promise<RegistryEntry[]> =>
    (await gate.listReposForWorkspace(org)).map(toEntry);
  return {
    readRegistry: mine,
    getProjectBySlug: async (org, slug) => (await mine(org)).find((e) => e.slug === slug) ?? null,
    getProjectByPath: async (org, p) => (await mine(org)).find((e) => e.path === p) ?? null,
  };
}

interface MountOptions {
  workTree?: WorkTreeProvider;
  contextSync?: ContextSyncStart;
  startSetup?: SetupStart;
  lookupInstallationAccount?: (
    installationId: number,
  ) => Promise<{ accountLogin: string; accountType: string } | null>;
  userInstallationsFor?: (code: string) => Promise<UserInstallation[]>;
}

let store: MemoryInstallationStore;
/** The workspace's Context, so a test can plant a source and read it back. */
let contextStore: ReturnType<typeof memoryContextStore>;

function buildApp(opts: MountOptions = {}): Express {
  // Wrapped exactly as boot wraps it, so every path that writes a repository
  // row reports it the way production does.
  const repos = observeRepositories(store);
  const github = createGithubConnection({
    store,
    repos,
    octokitFor: () => octokit,
    ...opts,
  });
  if (!github) throw new Error('expected a configured GitHub connection');
  return createApp({
    serveStatic: false,
    authVerifier: verify,
    repoLinks: repos,
    github,
    jobs: null,
  });
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
  Object.assign(process.env, APP_ENV);
});

beforeEach(async () => {
  vi.mocked(captureAction).mockClear();
  installMemorySessionRuns();
  // The per-repo guard surfaces this suite reaches are about VISIBILITY, not
  // guard data: the stores are here so the routes resolve, and hold nothing.
  installWorkTreeGuardStore();
  installMemoryGuardOverlays();
  installMemorySpecStore();
  store = new MemoryInstallationStore();
  // A push looks for the source that scopes the repository, so the workspace
  // store has to exist for the push hook to do anything.
  contextStore = memoryContextStore();
  setContextStore(contextStore);
  setRegistryStore(derivedRegistry(store));
  await seedInstallation(store, INSTALLATION_ID, [ORG]);
  // The onboarding scan runs on the connecting workspace's provider — give the
  // workspace one, and answer its pre-flight probe without a network call.
  const stored = { provider: 'anthropic' as const, model: 'claude-x', apiKey: 'sk-test' };
  setWorkspaceLlmConfigStore({
    getConfig: async (orgId) => (orgId === ORG ? stored : null),
    getSelection: async (orgId) => (orgId === ORG ? { kind: 'api', config: stored } : null),
    getView: async () => null,
    save: async () => {},
  });
  setWorkspaceLlmBackend({ probe: async () => {}, driver: () => ({ attribution: { provider: 'test', model: 'test-model' } }) as never });
  // Nothing connects into a workspace that has not said what its product is;
  // the refusal itself is pinned in the connect router's own suite.
  installDescribedWorkspaces();
});

afterEach(() => {
  resetWorkspaceProfiles();
  resetRegistryStore();
  resetContextStore();
  resetWorkspaceLlmConfigStore();
  resetWorkspaceLlmBackend();
  setWorkTreeProvider('github', null);
  resetSessionRuns();
  resetGuardStore();
  resetGuardOverlayStore();
  resetSpecStore();
  fs.rmSync(sessionsDir(REPO), { recursive: true, force: true });
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
      expect(createGithubConnection({ repos: store })).toBeNull();
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('answers every /api/github route with an actionable 503', async () => {
    const app = createApp({
      serveStatic: false,
      authVerifier: null,
      repoLinks: null,
      github: null,
      jobs: null,
    });

    const status = await request(app).get('/api/github/status').expect(503);
    expect(status.body.error).toMatch(/GITHUB_APP_ID/);
    expect(status.body.error).toMatch(/GITHUB_APP_PRIVATE_KEY/);
    expect(status.body.error).toMatch(/GITHUB_APP_WEBHOOK_SECRET/);
    expect(status.body.error).toMatch(/GITHUB_APP_SLUG/);
    expect(status.body.error).toMatch(/GITHUB_APP_CLIENT_ID/);
    expect(status.body.error).toMatch(/GITHUB_APP_CLIENT_SECRET/);

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
      startSetup: async () => 'queued',
    });
    await linkRepo(app).expect(201);
    // The source is Context's, made there: connecting makes none.
    await contextStore.createSource(ORG, {
      id: 'repo-acme-widgets',
      kind: 'repository',
      title: REPO,
      config: {
        repoFullName: REPO,
        installationId: INSTALLATION_ID,
        include: ['docs/**'],
        exclude: [],
        branch: 'main',
      },
    });

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

  it('refuses to clone through an installation the workspace no longer holds, minting no token', async () => {
    buildApp();
    // A context source made while the account was attached still names the
    // installation after the workspace removed it: the clone must stop there,
    // before any token is asked for.
    await store.unlinkInstallationFromWorkspace(INSTALLATION_ID, ORG);
    const failure = await acquireWorkTree('acme/handbook', {
      installationId: INSTALLATION_ID,
      workspaceOrgId: ORG,
    }).then(
      () => null,
      (err: unknown) => err as Error & { statusCode?: number },
    );
    expect(failure?.message).toMatch(/GitHub account this workspace no longer holds/);
    expect(failure?.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Naming an installation
// ---------------------------------------------------------------------------

describe('the connect callback', () => {
  /** The state /status would have minted for the workspace's session. */
  const state = (orgId = ORG) =>
    signConnectState(
      { orgId, userId: `u_${orgId}`, origin: 'settings', expiresAt: Date.now() + 60_000 },
      APP_ENV.TRUECOURSE_SECRET_KEY,
    );

  it('attaches the installations GitHub says the person can reach, named from that list', async () => {
    const codes: string[] = [];
    const app = buildApp({
      userInstallationsFor: async (code) => {
        codes.push(code);
        return [{ installationId: 99, accountLogin: 'octo', accountType: 'Organization' }];
      },
    });

    // No `installation` delivery for 99 — only the browser coming back from GitHub.
    await request(app)
      .get('/api/github/callback')
      .set('Cookie', `tc_session=${ORG}`)
      .query({ code: 'c0de', installation_id: '99', setup_action: 'install', state: state() })
      .expect(302)
      .expect('location', 'http://localhost:3000/settings/repositories?github=attached&accounts=octo&from=settings');

    expect(codes).toEqual(['c0de']);
    expect(await store.getInstallation(99)).toMatchObject({
      accountLogin: 'octo',
      accountType: 'Organization',
      workspaceOrgIds: [ORG],
    });
  });

  it('bounces a session-less return through login and comes back here', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/github/callback')
      .query({ code: 'c0de', state: state() })
      .expect(302);
    expect(res.headers.location).toMatch(/^\/api\/auth\/login\?next=/);
    expect(decodeURIComponent(res.headers.location.split('next=')[1]!)).toContain(
      '/api/github/callback?code=c0de',
    );
  });

  it("refuses a state minted for another workspace's session", async () => {
    const app = buildApp({
      userInstallationsFor: async () => [
        { installationId: 99, accountLogin: 'octo', accountType: 'Organization' },
      ],
    });
    await request(app)
      .get('/api/github/callback')
      .set('Cookie', `tc_session=${ORG}`)
      .query({ code: 'c0de', state: state(OTHER_ORG) })
      .expect(302)
      .expect('location', 'http://localhost:3000/settings/repositories?github=expired&from=settings');
    expect(await store.getInstallation(99)).toBeNull();
  });

  it('offers a plain authorize’s new installations on Settings, wherever the trip started', async () => {
    const app = buildApp({
      userInstallationsFor: async () => [
        { installationId: 99, accountLogin: 'octo', accountType: 'Organization' },
        { installationId: 98, accountLogin: 'nine', accountType: 'User' },
      ],
    });
    const fromCode = signConnectState(
      { orgId: ORG, userId: `u_${ORG}`, origin: 'code-connect', expiresAt: Date.now() + 60_000 },
      APP_ENV.TRUECOURSE_SECRET_KEY,
    );
    const res = await request(app)
      .get('/api/github/callback')
      .set('Cookie', `tc_session=${ORG}`)
      .query({ code: 'c0de', state: fromCode })
      .expect(302);
    const landing = new URL(res.headers.location);
    expect(landing.pathname).toBe('/settings/repositories');
    expect(landing.searchParams.get('github')).toBe('pick');
    expect(landing.searchParams.get('from')).toBe('code-connect');
    expect(await store.getInstallation(99)).toBeNull();

    // The pick lands the row; the Code connect dialog is where the page goes next.
    await request(app)
      .post('/api/github/installations/attach')
      .set('Cookie', `tc_session=${ORG}`)
      .send({ offer: landing.searchParams.get('offer'), installationIds: [99] })
      .expect(200);
    expect((await store.getInstallation(99))?.workspaceOrgIds).toEqual([ORG]);
  });

  it('points a source left behind by a removed account at the installation the account comes back under', async () => {
    // The last workspace removed acme (the App uninstalled, the row gone),
    // the source stayed, and the App was installed on acme again: no row
    // remembers the old id, so the repository's owner is the match.
    const app = buildApp({
      userInstallationsFor: async () => [
        { installationId: 5151, accountLogin: 'acme', accountType: 'Organization' },
      ],
    });
    await store.removeInstallation(INSTALLATION_ID);
    await contextStore.createSource(ORG, {
      id: 'repo-acme-handbook',
      kind: 'repository',
      title: 'acme/handbook',
      config: {
        repoFullName: 'acme/handbook',
        installationId: 161996555,
        include: ['docs/**'],
        exclude: [],
        branch: 'main',
      },
    });
    // Another owner's source is not touched, whatever it names.
    await contextStore.createSource(ORG, {
      id: 'repo-octo-notes',
      kind: 'repository',
      title: 'octo/notes',
      config: { repoFullName: 'octo/notes', installationId: 77, include: [], exclude: [], branch: 'main' },
    });

    await request(app)
      .get('/api/github/callback')
      .set('Cookie', `tc_session=${ORG}`)
      .query({ code: 'c0de', installation_id: '5151', setup_action: 'install', state: state() })
      .expect(302);

    const sources = await contextStore.listSources(ORG);
    expect(sources.find((s) => s.id === 'repo-acme-handbook')?.config).toMatchObject({ installationId: 5151 });
    expect(sources.find((s) => s.id === 'repo-octo-notes')?.config).toMatchObject({ installationId: 77 });
  });

  it('re-keys a Context source to the installation that replaced the one it read through', async () => {
    // The App reinstalled on acme: GitHub names the new id only, and a source
    // made under the old one has to keep syncing.
    const app = buildApp({
      userInstallationsFor: async () => [
        { installationId: 4242, accountLogin: 'acme', accountType: 'Organization' },
      ],
    });
    await contextStore.createSource(ORG, {
      id: 'repo-acme-handbook',
      kind: 'repository',
      title: 'acme/handbook',
      config: {
        repoFullName: 'acme/handbook',
        installationId: INSTALLATION_ID,
        include: ['docs/**'],
        exclude: [],
        branch: 'main',
      },
    });

    await request(app)
      .get('/api/github/callback')
      .set('Cookie', `tc_session=${ORG}`)
      .query({ code: 'c0de', state: state() })
      .expect(302)
      .expect('location', 'http://localhost:3000/settings/repositories?github=attached&accounts=acme&from=settings');

    expect(await store.getInstallation(INSTALLATION_ID)).toBeNull();
    expect((await store.getInstallation(4242))?.workspaceOrgIds).toEqual([ORG]);
    const [source] = await contextStore.listSources(ORG);
    expect(source?.config).toMatchObject({ repoFullName: 'acme/handbook', installationId: 4242 });
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
  // Connecting starts the repository's SETUP, which reads the code. What the
  // repository reads is Context's: no source is made here, and none is synced.
  it('writes the row, starts the setup, and clones nothing in the request', async () => {
    const started: Array<[string, string, string]> = [];
    const setups: string[] = [];
    const app = buildApp({
      contextSync: async (orgId, sourceId, source) => {
        started.push([orgId, sourceId, source]);
        return 'queued';
      },
      startSetup: async (link) => {
        setups.push(link.repoFullName);
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
      provider: 'github',
    });

    // The setup was started for the repository that landed, no sync went with
    // it, and no clone dir exists: the work happens on the queue, on the
    // connecting workspace's provider.
    expect(setups).toEqual([REPO]);
    expect(started).toEqual([]);
    expect(await contextStore.listSources(ORG)).toEqual([]);
    expect(fs.existsSync(getRunClonesDir())).toBe(false);

    // Reported once the row exists, as the person whose request wrote it.
    expect(captureAction).toHaveBeenCalledTimes(1);
    expect(captureAction).toHaveBeenCalledWith(EVENTS.repoConnected, {
      userId: `u_${ORG}`,
      workspaceId: ORG,
      properties: { repo: REPO, provider: 'github', via: 'app' },
    });
  });

  // Context owns the sources, so a repository whose own documentation is
  // already a source keeps it untouched: connecting neither edits its scope
  // (patterns, branch, account) nor binds the repository to it. The connect
  // dialog's Context step is what writes the bindings.
  it('leaves an existing source alone and creates none', async () => {
    const started: Array<[string, string, string]> = [];
    const app = buildApp({
      contextSync: async (orgId, sourceId, source) => {
        started.push([orgId, sourceId, source]);
        return 'queued';
      },
      startSetup: async () => 'queued',
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
    // Nothing was bound and nothing was synced: both are Context's to say.
    expect(await contextStore.bindings(ORG, REPO)).toEqual([]);
    expect(started).toEqual([]);
  });

  it('refuses to connect the same repository twice', async () => {
    let setups = 0;
    const app = buildApp({
      startSetup: async () => {
        setups += 1;
        return 'queued';
      },
    });

    await linkRepo(app).expect(201);
    // A second link would re-fire the whole onboarding chain on a live repo.
    await linkRepo(app).expect(409);
    expect(setups).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Unlinking a repo
// ---------------------------------------------------------------------------

describe('disconnecting a repository', () => {
  it('drops the row and the repo’s session transcripts', async () => {
    const app = buildApp({ startSetup: async () => 'queued' });
    await linkRepo(app).expect(201);

    // Transcripts a scan left behind, keyed by identity.
    (await createStoredSessionRun(REPO, { command: 'spec-scan', gitRef: 'abc' })).finish('completed');
    expect(fs.existsSync(sessionsDir(REPO))).toBe(true);

    await request(app)
      .delete('/api/github/repos/link')
      .query({ repoFullName: REPO })
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);

    expect(await store.getRepo(REPO)).toBeNull();
    expect(fs.existsSync(sessionsDir(REPO))).toBe(false);

    // The connect and the disconnect, in that order, both as the person.
    expect(captureAction.mock.calls.map((c) => c[0])).toEqual([
      EVENTS.repoConnected,
      EVENTS.repoDisconnected,
    ]);
    expect(captureAction).toHaveBeenLastCalledWith(EVENTS.repoDisconnected, {
      userId: `u_${ORG}`,
      workspaceId: ORG,
      properties: { repo: REPO, provider: 'github', via: 'app' },
    });
  });

  it('reports a repository GitHub took away as the workspace’s, with nobody behind it', async () => {
    const app = buildApp({ startSetup: async () => 'queued' });
    await linkRepo(app).expect(201);
    vi.mocked(captureAction).mockClear();

    const { payload, signature } = signed({
      action: 'removed',
      installation: { id: INSTALLATION_ID },
      repositories_removed: [{ full_name: REPO }],
    });
    await request(app)
      .post('/api/github/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'installation_repositories')
      .set('X-Hub-Signature-256', signature)
      .send(payload)
      .expect(202);

    expect(await store.getRepo(REPO)).toBeNull();
    // No session on a webhook, so no person: the workspace owns the event.
    expect(captureAction).toHaveBeenCalledTimes(1);
    expect(captureAction).toHaveBeenCalledWith(EVENTS.repoDisconnected, {
      workspaceId: ORG,
      properties: { repo: REPO, provider: 'github', via: 'github' },
    });
  });

  it('drops the link row when the repo is disconnected from Home', async () => {
    const app = buildApp({ startSetup: async () => 'queued' });
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
  const app = (): Express => buildApp({ startSetup: async () => 'queued' });

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

  it('404s the per-repo guard routes', async () => {
    const server = app();
    await linkRepo(server).expect(201);

    await request(server)
      .get(`/api/repos/${REPO_SLUG}/guard/staleness`)
      .set('Cookie', `tc_session=${OTHER_ORG}`)
      .expect(404);
    await request(server)
      .get(`/api/repos/${REPO_SLUG}/guard/staleness`)
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
  it("answers each repository's default branch, which the row recorded on link", async () => {
    const app = buildApp({ startSetup: async () => 'queued' });
    await linkRepo(app).expect(201);

    const mine = await request(app)
      .get('/api/repos')
      .set('Cookie', `tc_session=${ORG}`)
      .expect(200);
    expect((mine.body as Array<{ name: string; defaultBranch: string | null }>).map((r) => [r.name, r.defaultBranch])).toEqual([
      [REPO, 'main'],
    ]);
  });

  it("hides another workspace's connected repository", async () => {
    const app = buildApp({ startSetup: async () => 'queued' });
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

  it('fetches ONE commit into an empty repository when pinned to it, with the token only on the fetch', async () => {
    const { calls, run } = recordingGit();

    const clone = await createRunClone(REPO, 'ghs_secret_token', {
      workspaceOrgId: ORG,
      defaultBranch: 'main',
      commitSha: 'abc123',
      run,
    });

    const basic = Buffer.from('x-access-token:ghs_secret_token').toString('base64');
    const header = `http.https://github.com/.extraheader=Authorization: Basic ${basic}`;
    expect(calls.map((c) => c.args[0] === 'init' ? 'init' : c.args.includes('fetch') ? 'fetch' : c.args[0])).toEqual([
      'init',
      'remote',
      'fetch',
      'checkout',
    ]);
    expect(calls[0]!.args).toEqual(['init', '--quiet', clone.dir]);
    expect(calls[1]!.args).toEqual(['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
    expect(calls[2]!.args).toEqual(['-c', header, 'fetch', '--depth', '1', 'origin', 'abc123']);
    // Checked out as the branch the commit belongs to, so the tree's branch
    // reads as `main`, not `HEAD`.
    expect(calls[3]!.args).toEqual(['checkout', '--quiet', '-B', 'main', 'FETCH_HEAD']);
    for (const call of calls.slice(1)) expect(call.cwd).toBe(clone.dir);
    // No `--branch` on the fetch, and a per-command header leaves nothing to unset.
    expect(calls.flatMap((c) => c.args)).not.toContain('--branch');
    expect(calls.flatMap((c) => c.args)).not.toContain('config');
    clone.dispose();
  });

  it('checks a pinned commit out detached when no branch name is known', async () => {
    const { calls, run } = recordingGit();
    const clone = await createRunClone(REPO, 't', { workspaceOrgId: ORG, commitSha: 'abc123', run });
    expect(calls[3]!.args).toEqual(['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    clone.dispose();
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

  it('sweeps every run clone at boot, however recently it was written', async () => {
    const { run } = recordingGit();
    // A clone belongs to the process that made it, and a booting process made
    // none — so a clone written a second ago is as abandoned as an old one.
    const justNow = await createRunClone(REPO, 't', { workspaceOrgId: ORG, run });
    const older = await createRunClone(REPO, 't', { workspaceOrgId: OTHER_ORG, run });
    const oldTime = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(older.dir, oldTime, oldTime);
    // Anything that is not a run clone stays: the sweep goes by the prefix.
    const keep = path.join(getRunClonesDir(), 'org_a', 'not-a-run-clone');
    fs.mkdirSync(keep, { recursive: true });

    expect(sweepRunClones()).toBe(2);
    expect(fs.existsSync(justNow.dir)).toBe(false);
    expect(fs.existsSync(older.dir)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
  });
});
