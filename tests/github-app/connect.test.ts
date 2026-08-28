/**
 * The gate's half of the connect API: per-repo settings and the run feeds. It
 * mounts beside the connection router (whose own routes are covered in
 * tests/scm-github), so this app wires both exactly as `registerGithubApp` does.
 */
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AuthUser, GithubConnectStatusResponse } from '@truecourse/shared';
import {
  createConnectRouter,
  createConnectGateRouter,
  FileGateStore,
} from '../../ee/packages/github-app/src/index';
import type { OctokitClient } from '../../packages/scm-github/src/octokit';
// Shared via the bare specifier so this overrides the singleton the routers use.
import {
  setRegistryStore,
  resetRegistryStore,
  type RegistryStore,
} from '@truecourse/core/config/registry';

let dir: string;
let store: FileGateStore;
let app: Express;
let currentOrg: string | null;
const stubOctokit = { paginate: async () => [] } as unknown as OctokitClient;

// In hosted EE the registry is Postgres; stub it so the run feed's slug lookup
// doesn't touch the developer's real project list.
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
  app.use('/api/ee/github', createConnectGateRouter({ store }));
  setRegistryStore(stubRegistry);
});

afterEach(() => {
  resetRegistryStore();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function connectRepo(repoFullName = 'acme/api') {
  await store.saveInstallation({
    installationId: 100,
    accountLogin: 'acme',
    accountType: 'Organization',
    workspaceOrgId: 'org_A',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await store.linkRepo({
    repoFullName,
    installationId: 100,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

function repos(res: { body: unknown }) {
  return (res.body as GithubConnectStatusResponse).repos;
}

describe('connect gate settings', () => {
  it('toggles blocking on a connected repo', async () => {
    await connectRepo();

    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({ repoFullName: 'acme/api', blocking: false })
      .expect(200);

    const res = await request(app).get('/api/ee/github/status').expect(200);
    expect(repos(res)[0].blocking).toBe(false);
  });

  it('refuses to configure a repo in another workspace (404)', async () => {
    await connectRepo();
    currentOrg = 'org_B';
    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({ repoFullName: 'acme/api', blocking: false })
      .expect(404);
  });

  it('defaults all notification types on, and a partial PATCH flips only what it sends', async () => {
    await connectRepo();

    // Partial PATCH only flips gateFailure; the rest stay on.
    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({ repoFullName: 'acme/api', notifications: { gateFailure: false } })
      .expect(200);

    let res = await request(app).get('/api/ee/github/status').expect(200);
    expect(repos(res)[0].notifications).toEqual({
      gateFailure: false,
      conflicts: true,
      specRegen: true,
    });

    // specRegen is PATCHable like its siblings.
    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({ repoFullName: 'acme/api', notifications: { specRegen: false } })
      .expect(200);

    res = await request(app).get('/api/ee/github/status').expect(200);
    expect(repos(res)[0].notifications).toEqual({
      gateFailure: false,
      conflicts: true,
      specRegen: false,
    });
  });

  it('sets notifyEmails (normalized + deduped) and rejects invalid ones', async () => {
    await connectRepo();

    // Valid: normalized (lowercased) + deduped.
    await request(app)
      .patch('/api/ee/github/repos/config')
      .send({ repoFullName: 'acme/api', notifyEmails: ['A@x.com', 'a@x.com', 'b@y.com'] })
      .expect(200);
    const res = await request(app).get('/api/ee/github/status').expect(200);
    expect(repos(res)[0].notifyEmails).toEqual(['a@x.com', 'b@y.com']);

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
});

describe('connect gate run feeds', () => {
  it('returns runs only for a repo in the caller workspace', async () => {
    await connectRepo();
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

  it('workspace runs feed shows one row per PR — newest run wins', async () => {
    await connectRepo();
    // Two gate runs on the SAME PR (one per pushed commit).
    await store.recordRun({
      id: 'run-old',
      repoFullName: 'acme/api',
      prNumber: 7,
      headSha: 'aaaaaaa',
      baseSha: 'base',
      conclusion: 'failure',
      addedCount: 2,
      resolvedCount: 0,
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    await store.recordRun({
      id: 'run-new',
      repoFullName: 'acme/api',
      prNumber: 7,
      headSha: 'bbbbbbb',
      baseSha: 'base',
      conclusion: 'success',
      addedCount: 0,
      resolvedCount: 2,
      createdAt: '2026-01-03T00:00:00.000Z',
    });

    const res = await request(app).get('/api/ee/github/runs').expect(200);
    // One row for the PR, carrying the latest run's verdict + head.
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].prNumber).toBe(7);
    expect(res.body.runs[0].id).toBe('run-new');
    expect(res.body.runs[0].conclusion).toBe('success');
  });

  it('annotates the per-repo runs feed with PR state + title (null when untracked)', async () => {
    await connectRepo();
    const mkRun = (id: string, pr: number) => ({
      id,
      repoFullName: 'acme/api',
      prNumber: pr,
      headSha: `sha-${pr}`,
      baseSha: 'base',
      conclusion: 'success' as const,
      addedCount: 0,
      resolvedCount: 0,
      createdAt: `2026-01-0${pr}T00:00:00.000Z`,
    });
    await store.recordRun(mkRun('run-merged', 1));
    await store.recordRun(mkRun('run-untracked', 2));
    await store.upsertPr({
      repoFullName: 'acme/api',
      prNumber: 1,
      title: 'Add widget',
      state: 'merged',
      headSha: 'sha-1',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/ee/github/repos/acme/api/runs')
      .expect(200);
    const byId = Object.fromEntries(res.body.runs.map((r: any) => [r.id, r]));
    expect(byId['run-merged'].prState).toBe('merged');
    expect(byId['run-merged'].title).toBe('Add widget');
    // A run whose PR has no gh_prs row (pre-tracking history) → null state/title.
    expect(byId['run-untracked'].prState).toBeNull();
    expect(byId['run-untracked'].title).toBeNull();
  });

  it('carries PR state + title on the workspace feed (one row per PR)', async () => {
    await connectRepo();
    await store.recordRun({
      id: 'run-open',
      repoFullName: 'acme/api',
      prNumber: 5,
      headSha: 'sha-5',
      baseSha: 'base',
      conclusion: 'failure',
      addedCount: 1,
      resolvedCount: 0,
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    await store.upsertPr({
      repoFullName: 'acme/api',
      prNumber: 5,
      title: 'Open work',
      state: 'open',
      headSha: 'sha-5',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const res = await request(app).get('/api/ee/github/runs').expect(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].prNumber).toBe(5);
    expect(res.body.runs[0].prState).toBe('open');
    expect(res.body.runs[0].title).toBe('Open work');
  });
});
