/**
 * The link lifecycle seams: connecting a repo stores the link, then hands it to
 * `onRepoLinked` for whatever the host wants to do next (register the project,
 * kick an initial scan); disconnecting removes the link, then hands the record
 * it removed to `onRepoUnlinked` for the matching cleanup. Both are best-effort
 * — a hook that fails must never fail the action the user just took.
 */
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthUser } from '@truecourse/shared';
import {
  createConnectRouter,
  type OnRepoLinked,
  type OnRepoUnlinked,
} from '../../packages/scm-github/src/connect';
import type { OctokitClient } from '../../packages/scm-github/src/octokit';
import { MemoryGateStore } from './memory-store';

const ORG = 'org_A';
const REPO = 'mushgev/truecourse-gate-test';

let store: MemoryGateStore;
const octokit = { id: 'octokit-for-42' } as unknown as OctokitClient;

function makeApp(hooks: { onRepoLinked?: OnRepoLinked; onRepoUnlinked?: OnRepoUnlinked } = {}): Express {
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
      ...hooks,
    }),
  );
  return app;
}

function link(app: Express) {
  return request(app)
    .post('/api/ee/github/repos/link')
    .send({ repoFullName: REPO, installationId: 42, defaultBranch: 'main' });
}

function unlink(app: Express, repoFullName = REPO) {
  return request(app)
    .delete('/api/ee/github/repos/link')
    .query({ repoFullName });
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
    const res = await link(makeApp({ onRepoLinked }));

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
    const res = await link(makeApp({ onRepoLinked }));

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

    await link(makeApp({ onRepoLinked })).expect(409);
    expect(onRepoLinked).not.toHaveBeenCalled();
  });
});

describe('connect — the post-unlink seam', () => {
  it('hands the removed link to onRepoUnlinked', async () => {
    const onRepoUnlinked = vi.fn().mockResolvedValue(undefined);
    const app = makeApp({ onRepoUnlinked });
    await link(app).expect(201);

    await unlink(app).expect(200);

    expect(onRepoUnlinked).toHaveBeenCalledTimes(1);
    expect(onRepoUnlinked.mock.calls[0]![0]).toMatchObject({
      repoFullName: REPO,
      installationId: 42,
      workspaceOrgId: ORG,
    });
    // The hook runs AFTER the link is gone, so it sees a disconnected repo.
    expect(await store.getRepo(REPO)).toBeNull();
  });

  it('still unlinks (200) when the hook throws — best-effort', async () => {
    const onRepoUnlinked = vi.fn().mockRejectedValue(new Error('disk gone'));
    const app = makeApp({ onRepoUnlinked });
    await link(app).expect(201);

    await unlink(app).expect(200);
    expect(await store.getRepo(REPO)).toBeNull();
  });

  it('does not run the hook for a repo owned by another workspace', async () => {
    const onRepoUnlinked = vi.fn().mockResolvedValue(undefined);
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

    await unlink(makeApp({ onRepoUnlinked })).expect(200);
    expect(onRepoUnlinked).not.toHaveBeenCalled();
    expect(await store.getRepo(REPO)).not.toBeNull();
  });

  it('does not run the hook when nothing was connected', async () => {
    const onRepoUnlinked = vi.fn().mockResolvedValue(undefined);
    await unlink(makeApp({ onRepoUnlinked })).expect(200);
    expect(onRepoUnlinked).not.toHaveBeenCalled();
  });
});
