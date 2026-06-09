import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthUser } from '@truecourse/shared';

// registerProject writes to the file-based OSS registry; stub it so the connect
// route is exercised without touching disk.
vi.mock('@truecourse/core/config/registry', () => ({
  registerProject: vi.fn().mockResolvedValue(undefined),
  getProjectByPath: vi.fn().mockResolvedValue(null),
}));

import { createConnectRouter } from '../../ee/packages/github-app/src/connect';
import type { GateStore } from '../../ee/packages/github-app/src/store/types';

const ORG = 'org_A';

function makeApp(overrides: {
  store: Partial<GateStore>;
  enqueueBaseline?: ReturnType<typeof vi.fn>;
  getBranch?: ReturnType<typeof vi.fn>;
}): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { eeUser?: AuthUser }).eeUser = { id: 'u1', email: 'u@acme.test', organizationId: ORG };
    next();
  });
  const octokit = {
    repos: {
      getBranch:
        overrides.getBranch ?? vi.fn().mockResolvedValue({ data: { commit: { sha: 'deadbeefcafe' } } }),
    },
  };
  app.use(
    '/api/ee/github',
    createConnectRouter({
      store: overrides.store as GateStore,
      appSlug: 'tc-app',
      appUrl: 'http://localhost:3000',
      octokitFor: () => octokit as never,
      enqueueBaseline: overrides.enqueueBaseline,
    }),
  );
  return app;
}

describe('Connect — initial scan on link', () => {
  let store: Partial<GateStore>;
  beforeEach(() => {
    store = {
      getInstallation: vi.fn().mockResolvedValue({ installationId: 42, workspaceOrgId: ORG }),
      getRepo: vi.fn().mockResolvedValue(null),
      linkRepo: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('resolves the default-branch head SHA and enqueues a baseline scan', async () => {
    const enqueueBaseline = vi.fn().mockResolvedValue('job_1');
    const getBranch = vi.fn().mockResolvedValue({ data: { commit: { sha: 'abc1234567' } } });
    const app = makeApp({ store, enqueueBaseline, getBranch });

    const res = await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'mushgev/truecourse-gate-test', installationId: 42, defaultBranch: 'main' });

    expect(res.status).toBe(201);
    expect(getBranch).toHaveBeenCalledWith({ owner: 'mushgev', repo: 'truecourse-gate-test', branch: 'main' });
    expect(enqueueBaseline).toHaveBeenCalledWith({
      repoFullName: 'mushgev/truecourse-gate-test',
      installationId: 42,
      defaultBranch: 'main',
      commitSha: 'abc1234567',
      workspaceOrgId: ORG,
    });
  });

  it('still links the repo (201) when the scan enqueue fails — best-effort', async () => {
    const enqueueBaseline = vi.fn().mockRejectedValue(new Error('queue down'));
    const app = makeApp({ store, enqueueBaseline });

    const res = await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'mushgev/truecourse-gate-test', installationId: 42, defaultBranch: 'main' });

    expect(res.status).toBe(201);
    expect(store.linkRepo).toHaveBeenCalled();
  });

  it('links without enqueuing when no queue is wired (enqueueBaseline omitted)', async () => {
    const app = makeApp({ store }); // no enqueueBaseline
    const res = await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'mushgev/truecourse-gate-test', installationId: 42, defaultBranch: 'main' });
    expect(res.status).toBe(201);
    expect(store.linkRepo).toHaveBeenCalled();
  });
});
