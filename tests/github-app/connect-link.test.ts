/**
 * The link lifecycle seams, and the fact that both are TRANSACTIONAL.
 *
 * Connecting stores the link, then hands it to `onRepoLinked` for whatever the
 * host does next (clone, register the project, kick a scan); a hook that throws
 * rolls the link back, so a repo is never left "connected" with none of the work
 * behind it. Disconnecting runs `onRepoUnlinked` FIRST and only removes the link
 * once the cleanup succeeded, so a failed cleanup never orphans a clone the
 * ownership checks can no longer scope.
 */
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthUser } from '@truecourse/shared';
import {
  createConnectRouter,
  type OnRepoLinked,
  type OnRepoUnlinked,
} from '../../packages/github-app/src/connect';
import type { OctokitClient } from '../../packages/github-app/src/octokit';
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
      setupRedirectPath: '/preview?connect=1',
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

  it('rolls the link back and answers 502 when the hook throws', async () => {
    const onRepoLinked = vi.fn().mockRejectedValue(new Error('github unreachable'));
    const res = await link(makeApp({ onRepoLinked }));

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('github unreachable');
    // Nothing is left behind: the dialog can offer the repo again.
    expect(await store.getRepo(REPO)).toBeNull();
  });

  it('surfaces the status a hook error carries', async () => {
    const busy = Object.assign(new Error('a spec scan is running'), { statusCode: 409 });
    const res = await link(makeApp({ onRepoLinked: vi.fn().mockRejectedValue(busy) }));

    expect(res.status).toBe(409);
    expect(await store.getRepo(REPO)).toBeNull();
  });

  it('refuses to re-link a repo already connected to the caller workspace (409)', async () => {
    const onRepoLinked = vi.fn().mockResolvedValue(undefined);
    const app = makeApp({ onRepoLinked });
    await link(app).expect(201);
    expect(onRepoLinked).toHaveBeenCalledTimes(1);

    // Re-linking would re-run the hook, which deletes and re-clones the live
    // working copy out from under whatever is reading it.
    await link(app).expect(409);
    expect(onRepoLinked).toHaveBeenCalledTimes(1);
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
  it('hands the link being removed to onRepoUnlinked, then removes it', async () => {
    let seenDuringHook: unknown = 'not run';
    const onRepoUnlinked = vi.fn(async () => {
      seenDuringHook = await store.getRepo(REPO);
    });
    const app = makeApp({ onRepoUnlinked });
    await link(app).expect(201);

    await unlink(app).expect(200);

    expect(onRepoUnlinked).toHaveBeenCalledTimes(1);
    expect(onRepoUnlinked.mock.calls[0]![0]).toMatchObject({
      repoFullName: REPO,
      installationId: 42,
      workspaceOrgId: ORG,
    });
    // The cleanup runs while the repo is still owned, so nothing it leaves
    // behind can outlive the row that scopes it to a workspace.
    expect(seenDuringHook).not.toBeNull();
    expect(await store.getRepo(REPO)).toBeNull();
  });

  it('keeps the link when the cleanup throws, and surfaces its status', async () => {
    const busy = Object.assign(new Error('a spec scan is running'), { statusCode: 409 });
    const app = makeApp({ onRepoUnlinked: vi.fn().mockRejectedValue(busy) });
    await link(app).expect(201);

    const res = await unlink(app);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('a spec scan is running');
    // Still owned — so it is still hidden from every other workspace, and the
    // user can retry the disconnect.
    expect(await store.getRepo(REPO)).not.toBeNull();
  });

  it('fails the disconnect with 502 when the cleanup throws without a status', async () => {
    const app = makeApp({ onRepoUnlinked: vi.fn().mockRejectedValue(new Error('disk gone')) });
    await link(app).expect(201);

    await unlink(app).expect(502);
    expect(await store.getRepo(REPO)).not.toBeNull();
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
