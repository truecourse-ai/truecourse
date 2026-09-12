/**
 * What connecting, pushing to and disconnecting a repository do to Context.
 *
 * Connect: the repository's own documentation becomes a workspace source with
 * the default patterns and the link's installation, linked to itself, and its
 * sync is enqueued BEFORE the onboarding scan. A push to the default branch
 * syncs it again. Disconnect takes the repository's links and nothing else: the
 * sources are the workspace's, and a source is removed in Context.
 *
 * The hooks are driven through the real `createGithubConnection` mount (a
 * signed webhook for the push, the connect router's link hook for the rest), so
 * what is pinned is the wiring, not a helper called by hand.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import express, { type Express } from 'express';
import {
  resetContextStore,
  setContextStore,
} from '@truecourse/core/lib/context-store';
import {
  createGithubConnection,
  type ContextSyncStart,
} from '../../apps/dashboard/server/src/github/index';
import {
  ensureRepositoryContextSource,
  removeRepositoryContext,
  repositoryContextSource,
} from '../../apps/dashboard/server/src/services/context-lifecycle.service';
import { setContextEventPublisher } from '../../apps/dashboard/server/src/services/context.service';
import { memoryContextStore, type MemoryContextStore } from '../helpers/memory-context-store';
import { MemoryGateStore } from '../github-app/memory-store';

const ORG = 'org_A';
const REPO = 'acme/api';
const INSTALLATION_ID = 42;
const WEBHOOK_SECRET = 'webhook-secret';

const APP_ENV = {
  GITHUB_APP_ID: '1234',
  GITHUB_APP_PRIVATE_KEY: 'not-a-real-key',
  GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
  GITHUB_APP_SLUG: 'truecourse-test',
} as const;

let store: MemoryContextStore;
let gate: MemoryGateStore;
/** Every context sync the hooks asked for, in order. */
let syncs: { orgId: string; sourceId: string; source: string }[];

const contextSync: ContextSyncStart = async (orgId, sourceId, source) => {
  syncs.push({ orgId, sourceId, source });
  return 'queued';
};

beforeEach(async () => {
  Object.assign(process.env, APP_ENV);
  store = memoryContextStore();
  setContextStore(store);
  setContextEventPublisher(() => {});
  gate = new MemoryGateStore();
  syncs = [];
  await gate.saveInstallation({
    installationId: INSTALLATION_ID,
    accountLogin: 'acme',
    accountType: 'Organization',
    workspaceOrgId: ORG,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(() => {
  resetContextStore();
  setContextEventPublisher(null);
  for (const key of Object.keys(APP_ENV)) delete process.env[key];
});

/** A link row, as the connect flow writes one. */
async function link(repoFullName = REPO, org = ORG): Promise<void> {
  await gate.linkRepo({
    repoFullName,
    installationId: INSTALLATION_ID,
    workspaceOrgId: org,
    defaultBranch: 'main',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('connecting a repository', () => {
  it('creates its Repository source with the default patterns, linked to itself', async () => {
    await ensureRepositoryContextSource({
      repoFullName: REPO,
      workspaceOrgId: ORG,
      installationId: INSTALLATION_ID,
      defaultBranch: 'main',
    });
    const source = await repositoryContextSource(ORG, REPO);
    expect(source).toMatchObject({ id: 'repo-acme-api', kind: 'repository', title: REPO });
    expect(source!.config).toMatchObject({
      repoFullName: REPO,
      installationId: INSTALLATION_ID,
      branch: 'main',
      include: ['docs/**', '**/*.md'],
      exclude: expect.arrayContaining(['**/CHANGELOG*', '**/LICENSE*']),
    });
    expect(await store.bindings(ORG, REPO)).toEqual(['repo-acme-api']);
  });

  it('is idempotent, and keeps patterns that were edited since', async () => {
    await ensureRepositoryContextSource({
      repoFullName: REPO,
      workspaceOrgId: ORG,
      installationId: INSTALLATION_ID,
      defaultBranch: 'main',
    });
    await store.updateSource(ORG, 'repo-acme-api', {
      config: {
        repoFullName: REPO,
        installationId: INSTALLATION_ID,
        include: ['handbook/**'],
        exclude: [],
        branch: 'main',
      },
    });
    await ensureRepositoryContextSource({
      repoFullName: REPO,
      workspaceOrgId: ORG,
      installationId: INSTALLATION_ID,
      defaultBranch: 'main',
    });
    expect(await store.listSources(ORG)).toHaveLength(1);
    expect((await repositoryContextSource(ORG, REPO))!.config).toMatchObject({
      include: ['handbook/**'],
    });
  });

  it('does nothing at all when no workspace context store is installed', async () => {
    resetContextStore();
    expect(
      await ensureRepositoryContextSource({
        repoFullName: REPO,
        workspaceOrgId: ORG,
        installationId: INSTALLATION_ID,
        defaultBranch: 'main',
      }),
    ).toBeNull();
  });
});

describe('the connect hook', () => {
  // The onboarding chain starts in Context now: connecting creates the
  // repository's source and syncs it, and nothing else is enqueued here — the
  // sync chains the workspace Document scan, whose ripple starts Test setup.
  it('creates the source and syncs it, and enqueues nothing else', async () => {
    const github = createGithubConnection({
      store: gate,
      octokitFor: () => ({}) as never,
      workTree: async () => ({ dir: '/nowhere', dispose: () => {} }),
      contextSync: async (orgId, sourceId, source) => {
        syncs.push({ orgId, sourceId, source });
        return 'queued';
      },
    });
    expect(github).not.toBeNull();

    // The connect router's hook is what the flow calls; drive it the way the
    // flow does, through the mount's own onRepoLinked wiring.
    await linkThroughMount(github!, { repoFullName: REPO, workspaceOrgId: ORG });

    expect(syncs).toEqual([{ orgId: ORG, sourceId: 'repo-acme-api', source: 'add' }]);
    expect(await repositoryContextSource(ORG, REPO)).not.toBeNull();
  });
});

describe('a push to the default branch', () => {
  it('syncs the repository’s own source', async () => {
    await link();
    await ensureRepositoryContextSource({
      repoFullName: REPO,
      workspaceOrgId: ORG,
      installationId: INSTALLATION_ID,
      defaultBranch: 'main',
    });
    const app = webhookApp();
    await postPush(app, 'refs/heads/main');
    await settle();
    expect(syncs).toEqual([{ orgId: ORG, sourceId: 'repo-acme-api', source: 'push' }]);
  });

  it('ignores a push to another branch', async () => {
    await link();
    await ensureRepositoryContextSource({
      repoFullName: REPO,
      workspaceOrgId: ORG,
      installationId: INSTALLATION_ID,
      defaultBranch: 'main',
    });
    const app = webhookApp();
    await postPush(app, 'refs/heads/feature');
    await settle();
    expect(syncs).toEqual([]);
  });

  it('does nothing for a repository with no source yet', async () => {
    await link();
    const app = webhookApp();
    await postPush(app, 'refs/heads/main');
    await settle();
    expect(syncs).toEqual([]);
  });
});

describe('disconnecting a repository', () => {
  // Disconnecting in Code says nothing about what Context reads: every source
  // stays, with its scope and its installation, and only the links go.
  it('drops its links and keeps every source it read', async () => {
    await ensureRepositoryContextSource({
      repoFullName: REPO,
      workspaceOrgId: ORG,
      installationId: INSTALLATION_ID,
      defaultBranch: 'main',
    });
    await store.createSource(ORG, {
      id: 'site-docs',
      kind: 'site',
      title: 'Docs',
      config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
    });
    await store.setBindings(ORG, REPO, ['repo-acme-api', 'site-docs']);

    await removeRepositoryContext(ORG, REPO);

    expect(await store.bindings(ORG, REPO)).toEqual([]);
    // The repository's own source survives with the scope it was created with.
    const own = await repositoryContextSource(ORG, REPO);
    expect(own).not.toBeNull();
    expect(own!.config).toMatchObject({
      repoFullName: REPO,
      installationId: INSTALLATION_ID,
      branch: 'main',
    });
    expect(await store.reposForSource(ORG, 'repo-acme-api')).toEqual([]);
    // A SITE belongs to the workspace: losing one reader is not losing it.
    expect(await store.getSource(ORG, 'site-docs')).not.toBeNull();
  });

  it('keeps a Repository source another repository still reads', async () => {
    await ensureRepositoryContextSource({
      repoFullName: REPO,
      workspaceOrgId: ORG,
      installationId: INSTALLATION_ID,
      defaultBranch: 'main',
    });
    await store.setBindings(ORG, 'acme/web', ['repo-acme-api']);

    await removeRepositoryContext(ORG, REPO);

    expect(await repositoryContextSource(ORG, REPO)).not.toBeNull();
    expect(await store.reposForSource(ORG, 'repo-acme-api')).toEqual(['acme/web']);
  });

  it('tells the workspace its bindings moved, not its sources', async () => {
    const changes: { change: string; repoFullName?: string }[] = [];
    setContextEventPublisher((_org, event) => {
      if (event.type === 'context.changed') {
        changes.push({ change: event.change, repoFullName: event.repoFullName });
      }
    });
    await ensureRepositoryContextSource({
      repoFullName: REPO,
      workspaceOrgId: ORG,
      installationId: INSTALLATION_ID,
      defaultBranch: 'main',
    });
    changes.length = 0;

    await removeRepositoryContext(ORG, REPO);

    expect(changes).toEqual([{ change: 'bindings', repoFullName: REPO }]);
  });

  it('is silent when there is nothing to remove', async () => {
    await expect(removeRepositoryContext(ORG, 'nobody/here')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

/** The mount's webhook receiver, mounted the way app.ts mounts it. */
function webhookApp(): Express {
  const github = createGithubConnection({
    store: gate,
    octokitFor: () => ({}) as never,
    workTree: async () => ({ dir: '/nowhere', dispose: () => {} }),
    contextSync,
  });
  if (!github) throw new Error('expected a configured GitHub connection');
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use('/api/github', github.webhook);
  return app;
}

function postPush(app: Express, ref: string) {
  const body = {
    ref,
    after: 'c0ffee',
    repository: { full_name: REPO, default_branch: 'main' },
    installation: { id: INSTALLATION_ID },
  };
  const payload = JSON.stringify(body);
  const signature =
    'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return request(app)
    .post('/api/github/webhook')
    .set('content-type', 'application/json')
    .set('x-github-event', 'push')
    .set('x-hub-signature-256', signature)
    .send(payload)
    .expect(202);
}

/** The push handler is fire-and-forget; give its microtasks a tick. */
const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drive the connect router's link hook the way the connect flow does. The hook
 * is not exported, so the repo is linked through the gate store and the mount's
 * own wiring runs via the connect route's POST.
 */
async function linkThroughMount(
  github: { connect: express.Router },
  link: { repoFullName: string; workspaceOrgId: string },
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      id: 'u1',
      email: 'u@acme.test',
      organizationId: link.workspaceOrgId,
    };
    next();
  });
  app.use('/api/github', github.connect);
  await request(app)
    .post('/api/github/repos/link')
    .send({
      installationId: INSTALLATION_ID,
      repoFullName: link.repoFullName,
      defaultBranch: 'main',
    })
    .expect(201);
}
