import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  AuthUser,
  GithubConnectStatusResponse,
  GithubInstallationReposResponse,
} from '@truecourse/shared';
import { createConnectRouter } from '../../packages/scm-github/src/index';
import type { OctokitClient } from '../../packages/scm-github/src/octokit';
import { MemoryGateStore } from './memory-store';
// Shared via the bare specifier so this overrides the singleton `connect.ts` uses.
import {
  setRegistryStore,
  resetRegistryStore,
  type RegistryStore,
} from '@truecourse/core/config/registry';

let store: MemoryGateStore;
let app: Express;
let currentOrg: string | null;
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
      octokitFor: () => stubOctokit,
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
      .expect('location', 'http://localhost:3000/repositories');
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

  it('rejects an invalid link payload with 400', async () => {
    await seedInstallation('org_A');
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api' }) // missing installationId + defaultBranch
      .expect(400);
  });
});
