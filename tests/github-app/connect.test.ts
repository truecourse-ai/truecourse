import express, { type Express, type Request } from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AuthUser, GithubConnectStatusResponse } from '@truecourse/shared';
import { createConnectRouter, FileGateStore } from '../../ee/packages/github-app/src/index';
// Shared via the bare specifier so this overrides the singleton `connect.ts` uses.
import {
  setRegistryStore,
  resetRegistryStore,
  type RegistryStore,
} from '@truecourse/core/config/registry';

let dir: string;
let store: FileGateStore;
let app: Express;
let currentOrg: string | null;

// In hosted EE the registry is Postgres; stub it here so the connect router's
// `registerProject(repoFullName)` doesn't create an `<cwd>/owner/repo/.truecourse`
// dir with the file-backed default.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-connect-'));
  store = new FileGateStore(dir);
  currentOrg = 'org_A';
  app = express();
  app.use(express.json());
  // Stand in for the enterprise auth gate: attach req.eeUser.
  app.use((req, _res, next) => {
    (req as Request & { eeUser?: AuthUser }).eeUser = {
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
    }),
  );
  setRegistryStore(stubRegistry);
});

afterEach(() => {
  resetRegistryStore();
  fs.rmSync(dir, { recursive: true, force: true });
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
      .expect('location', 'http://localhost:3000/integrations/github');
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

  it('links, toggles blocking, lists, and unlinks a repo', async () => {
    await seedInstallation('org_A');

    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(201);

    let res = await request(app).get('/api/ee/github/status').expect(200);
    expect((res.body as GithubConnectStatusResponse).repos).toHaveLength(1);
    expect((res.body as GithubConnectStatusResponse).repos[0].blocking).toBe(true);

    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({ repoFullName: 'acme/api', blocking: false })
      .expect(200);

    res = await request(app).get('/api/ee/github/status').expect(200);
    expect((res.body as GithubConnectStatusResponse).repos[0].blocking).toBe(false);

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

  it('sets notifyEmails (normalized + deduped) and rejects invalid ones', async () => {
    await seedInstallation('org_A');
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(201);

    // Valid: normalized (lowercased) + deduped.
    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({ repoFullName: 'acme/api', notifyEmails: ['A@x.com', 'a@x.com', 'b@y.com'] })
      .expect(200);
    const res = await request(app).get('/api/ee/github/status').expect(200);
    expect((res.body as GithubConnectStatusResponse).repos[0].notifyEmails).toEqual([
      'a@x.com',
      'b@y.com',
    ]);

    // Invalid address → 400 (not silently dropped).
    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({ repoFullName: 'acme/api', notifyEmails: ['ok@x.com', 'not-an-email'] })
      .expect(400);

    // Over the cap → 400.
    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({
        repoFullName: 'acme/api',
        notifyEmails: Array.from({ length: 21 }, (_, i) => `u${i}@x.com`),
      })
      .expect(400);
  });

  it('returns runs only for a repo in the caller workspace', async () => {
    await seedInstallation('org_A');
    await store.linkRepo({
      repoFullName: 'acme/api',
      installationId: 100,
      workspaceOrgId: 'org_A',
      defaultBranch: 'main',
      blocking: true,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await store.recordRun({
      id: 'run1',
      repoFullName: 'acme/api',
      prNumber: 3,
      headSha: 'sha',
      baseSha: 'base',
      conclusion: 'failure',
      addedCount: 2,
      resolvedCount: 1,
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/ee/github/repos/acme/api/runs')
      .expect(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].conclusion).toBe('failure');

    // A different org sees nothing.
    currentOrg = 'org_B';
    const res2 = await request(app)
      .get('/api/ee/github/repos/acme/api/runs')
      .expect(200);
    expect(res2.body.runs).toEqual([]);
  });
});
