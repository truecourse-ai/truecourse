import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type {
  AuthUser,
  GithubConnectStatusResponse,
  GithubInstallationReposResponse,
} from '@truecourse/shared';
import { createConnectRouter } from '../../packages/github-app/src/index';
import type { ConnectDeps } from '../../packages/github-app/src/connect';
import type { OctokitClient } from '../../packages/github-app/src/octokit';
import { MemoryGateStore } from './memory-store';
// Shared via the bare specifier so this overrides the singleton `connect.ts` uses.
import {
  setRegistryStore,
  resetRegistryStore,
  type RegistryStore,
} from '@truecourse/core/config/registry';

type AccountLookup = NonNullable<ConnectDeps['lookupInstallationAccount']>;

let store: MemoryGateStore;
let app: Express;
let currentOrg: string | null;
// The App-level account lookup the host injects. A row that already carries a
// login must never reach it — that is half of what these tests pin.
let lookupAccount: Mock<AccountLookup>;
// Repos the stubbed installation client returns (the connect router paginates it).
let installRepos: Array<{ full_name: string; default_branch: string; private: boolean }>;
const stubOctokit = {
  apps: { listReposAccessibleToInstallation: () => undefined },
  paginate: async () => installRepos,
} as unknown as OctokitClient;

// The repo overview resolves each repo's dashboard slug; stub the registry so the
// test never reads (or writes) the developer's real project list.
const stubRegistry: RegistryStore = {
  readRegistry: async () => [],
  pruneStaleProjects: async () => [],
  getProjectBySlug: async () => null,
  getProjectByPath: async () => null,
  registerProject: async (p, name) => ({ slug: 'stub', name: name ?? p, path: p }),
  unregisterProject: async () => false,
  touchProject: async () => {},
  setLastAnalyzed: async () => {},
};

beforeEach(() => {
  store = new MemoryGateStore();
  currentOrg = 'org_A';
  installRepos = [
    { full_name: 'acme/api', default_branch: 'main', private: true },
    { full_name: 'acme/web', default_branch: 'develop', private: false },
  ];
  lookupAccount = vi.fn<AccountLookup>(async () => ({
    accountLogin: 'acme',
    accountType: 'Organization',
  }));
  app = express();
  app.use(express.json());
  // Stand in for the auth gate: attach req.user.
  app.use((req, _res, next) => {
    (req as Request & { user?: AuthUser }).user = {
      id: 'u1',
      email: 'u@acme.test',
      organizationId: currentOrg,
    };
    next();
  });
  app.use(
    '/api/ee/github',
    createConnectRouter({
      store,
      appSlug: 'tc-gate',
      appUrl: 'http://localhost:3000',
      setupRedirectPath: '/preview?connect=1',
      octokitFor: () => stubOctokit,
      lookupInstallationAccount: lookupAccount,
    }),
  );
  setRegistryStore(stubRegistry);
});

afterEach(() => {
  resetRegistryStore();
});

async function seedInstallation(org: string | null = 'org_A') {
  await store.saveInstallation({
    installationId: 100,
    accountLogin: 'acme',
    accountType: 'Organization',
    workspaceOrgId: org,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('connect router', () => {
  it('returns an install URL carrying the workspace id and the org installations', async () => {
    await seedInstallation('org_A');
    const res = await request(app).get('/api/ee/github/status').expect(200);
    const body = res.body as GithubConnectStatusResponse;
    expect(body.configured).toBe(true);
    expect(body.installUrl).toContain('apps/tc-gate/installations/new');
    expect(body.installUrl).toContain('state=org_A');
    expect(body.installations.map((i) => i.installationId)).toEqual([100]);
    expect(body.repos).toEqual([]);
  });

  it('returns an empty status when the user has no organization', async () => {
    currentOrg = null;
    const res = await request(app).get('/api/ee/github/status').expect(200);
    const body = res.body as GithubConnectStatusResponse;
    expect(body.installUrl).toBe('');
    expect(body.installations).toEqual([]);
  });

  it('lists the installation’s accessible repos for the connect picker', async () => {
    await seedInstallation('org_A');
    const res = await request(app)
      .get('/api/ee/github/installations/100/repos')
      .expect(200);
    const body = res.body as GithubInstallationReposResponse;
    expect(body.repos).toEqual([
      { fullName: 'acme/api', defaultBranch: 'main', private: true },
      { fullName: 'acme/web', defaultBranch: 'develop', private: false },
    ]);
  });

  it('refuses to list repos for an installation in another workspace', async () => {
    await seedInstallation('org_OTHER');
    await request(app).get('/api/ee/github/installations/100/repos').expect(403);
  });

  it('refuses to link a repo whose installation is not in the workspace', async () => {
    await seedInstallation('org_OTHER'); // installation 100 belongs to a different org
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(403);
  });

  it('does NOT re-link an installation owned by another workspace via /setup (IDOR guard)', async () => {
    await seedInstallation('org_OTHER'); // installation 100 belongs to org_OTHER
    // org_A (currentOrg) tries to claim it through the setup callback.
    await request(app)
      .get('/api/ee/github/setup')
      .query({ installation_id: '100', state: 'org_A' })
      .expect(302)
      .expect('location', 'http://localhost:3000/preview?connect=1');
    // Ownership is unchanged.
    expect((await store.getInstallation(100))?.workspaceOrgId).toBe('org_OTHER');
  });

  it('links an unowned installation to the caller workspace via /setup', async () => {
    await seedInstallation(null); // installation 100 is unlinked
    await request(app)
      .get('/api/ee/github/setup')
      .query({ installation_id: '100', state: 'org_A' })
      .expect(302);
    expect((await store.getInstallation(100))?.workspaceOrgId).toBe('org_A');
  });

  it('refuses to link a repo already connected to another workspace (409)', async () => {
    await seedInstallation('org_A'); // org_A owns installation 100
    await store.linkRepo({
      repoFullName: 'acme/api',
      installationId: 200,
      workspaceOrgId: 'org_OTHER', // already owned by another workspace
      defaultBranch: 'main',
      blocking: true,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(409);
    // The original owner is untouched.
    expect((await store.getRepo('acme/api'))?.workspaceOrgId).toBe('org_OTHER');
  });

  it('links, lists, and unlinks a repo', async () => {
    await seedInstallation('org_A');

    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(201);

    let res = await request(app).get('/api/ee/github/status').expect(200);
    expect((res.body as GithubConnectStatusResponse).repos).toHaveLength(1);
    expect((res.body as GithubConnectStatusResponse).repos[0].blocking).toBe(true);
    // Unset on the record → the API resolves every notification type on.
    expect((res.body as GithubConnectStatusResponse).repos[0].notifications).toEqual({
      gateFailure: true,
      conflicts: true,
      specRegen: true,
    });

    await request(app)
      .delete('/api/ee/github/repos/link')
      .query({ repoFullName: 'acme/api' })
      .expect(200);

    res = await request(app).get('/api/ee/github/status').expect(200);
    expect((res.body as GithubConnectStatusResponse).repos).toEqual([]);
  });

  it('lands the setup callback on the path its host declared', async () => {
    await seedInstallation(null);
    // A second host, whose SPA has no /preview at all.
    const eeApp = express();
    eeApp.use(express.json());
    eeApp.use((req, _res, next) => {
      (req as Request & { user?: AuthUser }).user = {
        id: 'u1',
        email: 'u@acme.test',
        organizationId: 'org_A',
      };
      next();
    });
    eeApp.use(
      '/api/ee/github',
      createConnectRouter({
        store,
        appSlug: 'tc-gate',
        appUrl: 'https://app.truecourse.test',
        setupRedirectPath: '/repositories?connect=1',
        octokitFor: () => stubOctokit,
      }),
    );

    await request(eeApp)
      .get('/api/ee/github/setup')
      .query({ installation_id: '100', state: 'org_A' })
      .expect(302)
      .expect('location', 'https://app.truecourse.test/repositories?connect=1');
  });

  it('skips the per-repo spec reads on ?slim=1', async () => {
    await seedInstallation('org_A');
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(201);

    const getBaseline = vi.spyOn(store, 'getBaseline');

    const slim = await request(app)
      .get('/api/ee/github/status')
      .query({ slim: '1' })
      .expect(200);
    const body = slim.body as GithubConnectStatusResponse;
    // Everything the connect dialog reads is still there.
    expect(body.installUrl).toContain('state=org_A');
    expect(body.installations.map((i) => i.installationId)).toEqual([100]);
    expect(body.repos.map((r) => r.repoFullName)).toEqual(['acme/api']);
    // The enrichment did not run: no baseline read, so no corpus read either.
    expect(getBaseline).not.toHaveBeenCalled();
    expect(body.repos[0]!.slug).toBeNull();
    expect(body.repos[0]!.openConflicts).toBe(0);

    // The full read still enriches.
    await request(app).get('/api/ee/github/status').expect(200);
    expect(getBaseline).toHaveBeenCalledWith('acme/api');
  });

  it('rejects an invalid link payload with 400', async () => {
    await seedInstallation('org_A');
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api' }) // missing installationId + defaultBranch
      .expect(400);
  });
});

/**
 * Who an installation belongs to comes from the App API, not from the
 * `installation` webhook: a webhook that is late — or misconfigured, so it never
 * arrives at all — used to leave the row anonymous and the UI showing `#<id>`.
 */
describe('the account behind an installation', () => {
  /** A row created by /setup before this fix: linked, but nameless. */
  async function seedAnonymous(installationId = 157207108) {
    await store.saveInstallation({
      installationId,
      accountLogin: '',
      accountType: '',
      workspaceOrgId: 'org_A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  it('names a fresh installation at /setup, without waiting for the webhook', async () => {
    lookupAccount.mockResolvedValue({ accountLogin: 'octo-org', accountType: 'Organization' });

    await request(app)
      .get('/api/ee/github/setup')
      .query({ installation_id: '157207108', state: 'org_A' })
      .expect(302);

    expect(lookupAccount).toHaveBeenCalledWith(157207108);
    expect(await store.getInstallation(157207108)).toMatchObject({
      accountLogin: 'octo-org',
      accountType: 'Organization',
      workspaceOrgId: 'org_A',
    });
  });

  it('keeps what the webhook already wrote, and does not call the API for it', async () => {
    await seedInstallation(null); // the webhook's row: 'acme' / Organization, unlinked

    await request(app)
      .get('/api/ee/github/setup')
      .query({ installation_id: '100', state: 'org_A' })
      .expect(302);

    expect(lookupAccount).not.toHaveBeenCalled();
    expect(await store.getInstallation(100)).toMatchObject({
      accountLogin: 'acme',
      accountType: 'Organization',
      workspaceOrgId: 'org_A',
    });
  });

  it('names a row left anonymous by /setup on the next status read, once', async () => {
    await seedAnonymous();
    lookupAccount.mockResolvedValue({ accountLogin: 'octo-org', accountType: 'Organization' });

    const first = await request(app)
      .get('/api/ee/github/status')
      .query({ slim: '1' })
      .expect(200);
    expect((first.body as GithubConnectStatusResponse).installations).toEqual([
      { installationId: 157207108, accountLogin: 'octo-org', accountType: 'Organization' },
    ]);
    // Persisted, so the next read is already named and costs no API call.
    expect(await store.getInstallation(157207108)).toMatchObject({
      accountLogin: 'octo-org',
      workspaceOrgId: 'org_A',
    });

    const second = await request(app)
      .get('/api/ee/github/status')
      .query({ slim: '1' })
      .expect(200);
    expect((second.body as GithubConnectStatusResponse).installations[0]!.accountLogin).toBe(
      'octo-org',
    );
    expect(lookupAccount).toHaveBeenCalledTimes(1);
  });

  it('names it on the full status read too', async () => {
    await seedAnonymous();
    lookupAccount.mockResolvedValue({ accountLogin: 'octo-org', accountType: 'User' });

    const res = await request(app).get('/api/ee/github/status').expect(200);
    expect((res.body as GithubConnectStatusResponse).installations).toEqual([
      { installationId: 157207108, accountLogin: 'octo-org', accountType: 'User' },
    ]);
    expect(await store.getInstallation(157207108)).toMatchObject({ accountLogin: 'octo-org' });
  });

  it('still answers when the lookup fails, leaving the row as it is', async () => {
    await seedAnonymous();
    lookupAccount.mockRejectedValue(new Error('GitHub is down'));

    const res = await request(app)
      .get('/api/ee/github/status')
      .query({ slim: '1' })
      .expect(200);
    // The dialog falls back to `#<id>` on an empty login — nothing 502s.
    expect((res.body as GithubConnectStatusResponse).installations[0]!.accountLogin).toBe('');
    expect(await store.getInstallation(157207108)).toMatchObject({ accountLogin: '' });
  });
});
