/**
 * What connecting, pushing to and disconnecting a repository do to Context.
 *
 * Connect: nothing. Sources are made in Context, so connecting a repository in
 * Code creates none and syncs none; it starts the repository's setup and leaves
 * what it reads to the connect dialog's Context step. A push to the default
 * branch syncs the source that already scopes the repository. Disconnect takes
 * the repository's links and nothing else: the sources are the workspace's, and
 * a source is removed in Context.
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

/** The repository's own documentation, as Context holds it: a workspace source. */
async function ownSource(repoFullName = REPO, org = ORG): Promise<void> {
  await store.createSource(org, {
    id: 'repo-acme-api',
    kind: 'repository',
    title: repoFullName,
    config: {
      repoFullName,
      installationId: INSTALLATION_ID,
      include: ['docs/**', '**/*.md'],
      exclude: [],
      branch: 'main',
    },
  });
}

describe('the connect hook', () => {
  // Connecting starts the repository's setup, which reads the CODE. Context is
  // the other side of the product: no source is made here, and none is synced.
  it('starts the setup, creates no source and syncs nothing', async () => {
    const setups: string[] = [];
    const github = createGithubConnection({
      store: gate,
      octokitFor: () => ({}) as never,
      workTree: async () => ({ dir: '/nowhere', dispose: () => {} }),
      contextSync: async (orgId, sourceId, source) => {
        syncs.push({ orgId, sourceId, source });
        return 'queued';
      },
      startSetup: async (linked) => {
        setups.push(linked.repoFullName);
        return 'queued';
      },
    });
    expect(github).not.toBeNull();

    // The connect router's hook is what the flow calls; drive it the way the
    // flow does, through the mount's own onRepoLinked wiring.
    await linkThroughMount(github!, { repoFullName: REPO, workspaceOrgId: ORG });

    expect(setups).toEqual([REPO]);
    expect(syncs).toEqual([]);
    expect(await store.listSources(ORG)).toEqual([]);
    expect(await store.bindings(ORG, REPO)).toEqual([]);
  });
});

describe('a push to the default branch', () => {
  it('syncs the repository’s own source', async () => {
    await link();
    await ownSource();
    const app = webhookApp();
    await postPush(app, 'refs/heads/main');
    await settle();
    expect(syncs).toEqual([{ orgId: ORG, sourceId: 'repo-acme-api', source: 'push' }]);
  });

  it('ignores a push to another branch', async () => {
    await link();
    await ownSource();
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
    await ownSource();
    await store.createSource(ORG, {
      id: 'site-docs',
      kind: 'site',
      title: 'Docs',
      config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
    });
    await store.setBindings(ORG, REPO, ['repo-acme-api', 'site-docs']);

    await removeRepositoryContext(ORG, REPO);

    expect(await store.bindings(ORG, REPO)).toEqual([]);
    // The repository's own source survives with the scope Context gave it.
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
    await ownSource();
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
    await ownSource();
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
