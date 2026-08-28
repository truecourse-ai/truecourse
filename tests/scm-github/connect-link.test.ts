/**
 * The post-link seam: connecting a repo stores the link, then hands it to
 * `onRepoLinked` for whatever the host wants to do next (register the project,
 * kick an initial scan). The seam is best-effort — a hook that fails must never
 * fail the link the user just made.
 */
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthUser } from '@truecourse/shared';
import { createConnectRouter, type OnRepoLinked } from '../../packages/scm-github/src/connect';
import type { OctokitClient } from '../../packages/scm-github/src/octokit';
import { MemoryGateStore } from './memory-store';

const ORG = 'org_A';
const REPO = 'mushgev/truecourse-gate-test';

let store: MemoryGateStore;
const octokit = { id: 'octokit-for-42' } as unknown as OctokitClient;

function makeApp(onRepoLinked?: OnRepoLinked): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user?: AuthUser }).user = {
      id: 'u1',
      email: 'u@acme.test',
      organizationId: ORG,
    };
    next();
  });
  app.use(
    '/api/ee/github',
    createConnectRouter({
      store,
      appSlug: 'tc-app',
      appUrl: 'http://localhost:3000',
      octokitFor: () => octokit,
      onRepoLinked,
    }),
  );
  return app;
}

function link(app: Express) {
  return request(app)
    .post('/api/ee/github/repos/link')
    .send({ repoFullName: REPO, installationId: 42, defaultBranch: 'main' });
}

beforeEach(async () => {
  store = new MemoryGateStore();
  await store.saveInstallation({
    installationId: 42,
    accountLogin: 'mushgev',
    accountType: 'User',
    workspaceOrgId: ORG,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
});

describe('connect — the post-link seam', () => {
  it('hands the stored link and an installation client to onRepoLinked', async () => {
    const onRepoLinked = vi.fn().mockResolvedValue(undefined);
    const res = await link(makeApp(onRepoLinked));

    expect(res.status).toBe(201);
    expect(onRepoLinked).toHaveBeenCalledTimes(1);
    const [record, client] = onRepoLinked.mock.calls[0]!;
    expect(record).toMatchObject({
      repoFullName: REPO,
      installationId: 42,
      defaultBranch: 'main',
      workspaceOrgId: ORG,
      enabled: true,
    });
    expect(client).toBe(octokit);
    // The hook runs AFTER the link is persisted, so it sees a connected repo.
    expect(await store.getRepo(REPO)).not.toBeNull();
  });

  it('still links the repo (201) when the hook throws — best-effort', async () => {
    const onRepoLinked = vi.fn().mockRejectedValue(new Error('queue down'));
    const res = await link(makeApp(onRepoLinked));

    expect(res.status).toBe(201);
    expect(await store.getRepo(REPO)).not.toBeNull();
  });

  it('links without a hook wired', async () => {
    const res = await link(makeApp());
    expect(res.status).toBe(201);
    expect(await store.getRepo(REPO)).not.toBeNull();
  });

  it('does not run the hook when the link is refused', async () => {
    const onRepoLinked = vi.fn().mockResolvedValue(undefined);
    await store.linkRepo({
      repoFullName: REPO,
      installationId: 99,
      workspaceOrgId: 'org_OTHER',
      defaultBranch: 'main',
      blocking: true,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await link(makeApp(onRepoLinked)).expect(409);
    expect(onRepoLinked).not.toHaveBeenCalled();
  });
});
