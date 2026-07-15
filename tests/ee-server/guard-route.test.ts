/**
 * POST /api/ee/guard/generate — the manual hosted "Generate" trigger. The server
 * resolves installation/branch/head from the stored repo + baseline records
 * (the client sends only the repo identifier); enqueue is single-flight (409 on
 * a concurrent generate), unknown / other-workspace repos 404, an unscanned repo
 * 409 (no baseline commit to key the scenarios by), and a missing LLM provider
 * is a synchronous 409 rather than a failed job.
 */
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuthUser } from '@truecourse/shared';
import { setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import { createGuardRouter } from '../../ee/packages/server/src/guard/index';

const ORG = 'org_A';
const REPO = 'acme/api';

const fakeTransport: LlmTransport = async () => {
  throw new Error('the fake transport must never be invoked');
};

const repoLink = {
  repoFullName: REPO,
  installationId: 42,
  workspaceOrgId: ORG,
  defaultBranch: 'main',
};

function makeApp(overrides: {
  getRepo?: ReturnType<typeof vi.fn>;
  getBaseline?: ReturnType<typeof vi.fn>;
  enqueueGuardGenerate?: ReturnType<typeof vi.fn>;
  org?: string | null;
}): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const org = overrides.org === undefined ? ORG : overrides.org;
    (req as Request & { eeUser?: AuthUser }).eeUser = org
      ? { id: 'u1', email: 'u@acme.test', organizationId: org }
      : undefined;
    next();
  });
  app.use(
    '/api/ee/guard',
    createGuardRouter({
      store: {
        getRepo: overrides.getRepo ?? vi.fn().mockResolvedValue(repoLink),
        getBaseline:
          overrides.getBaseline ??
          vi.fn().mockResolvedValue({ repoFullName: REPO, commitSha: 'abc1234567' }),
      },
      enqueueGuardGenerate: overrides.enqueueGuardGenerate ?? vi.fn().mockResolvedValue('job_g1'),
    }),
  );
  return app;
}

beforeEach(() => {
  setDefaultTransport(fakeTransport);
});
afterEach(() => {
  setDefaultTransport(undefined);
});

describe('POST /api/ee/guard/generate', () => {
  it('resolves installation/branch/baseline-head server-side and enqueues (202 + jobId)', async () => {
    const enqueueGuardGenerate = vi.fn().mockResolvedValue('job_g1');
    const app = makeApp({ enqueueGuardGenerate });

    const res = await request(app).post('/api/ee/guard/generate').send({ repoFullName: REPO });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: 'job_g1' });
    expect(enqueueGuardGenerate).toHaveBeenCalledWith({
      repoFullName: REPO,
      installationId: 42,
      defaultBranch: 'main',
      commitSha: 'abc1234567',
      workspaceOrgId: ORG,
    });
  });

  it('409 when a generate is already running (single-flight)', async () => {
    const app = makeApp({ enqueueGuardGenerate: vi.fn().mockResolvedValue(null) });
    const res = await request(app).post('/api/ee/guard/generate').send({ repoFullName: REPO });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it('404 for a repo that is not connected', async () => {
    const enqueueGuardGenerate = vi.fn();
    const app = makeApp({ getRepo: vi.fn().mockResolvedValue(null), enqueueGuardGenerate });
    const res = await request(app).post('/api/ee/guard/generate').send({ repoFullName: 'x/y' });
    expect(res.status).toBe(404);
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it("404 for another workspace's repo (no cross-tenant trigger)", async () => {
    const enqueueGuardGenerate = vi.fn();
    const app = makeApp({
      getRepo: vi.fn().mockResolvedValue({ ...repoLink, workspaceOrgId: 'org_B' }),
      enqueueGuardGenerate,
    });
    const res = await request(app).post('/api/ee/guard/generate').send({ repoFullName: REPO });
    expect(res.status).toBe(404);
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it('409 when the repo has no baseline yet (initial scan still pending)', async () => {
    const enqueueGuardGenerate = vi.fn();
    const app = makeApp({ getBaseline: vi.fn().mockResolvedValue(null), enqueueGuardGenerate });
    const res = await request(app).post('/api/ee/guard/generate').send({ repoFullName: REPO });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/scan/i);
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it('409 when no LLM provider is configured (synchronous, not a failed job)', async () => {
    setDefaultTransport(undefined);
    const enqueueGuardGenerate = vi.fn();
    const app = makeApp({ enqueueGuardGenerate });
    const res = await request(app).post('/api/ee/guard/generate').send({ repoFullName: REPO });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/LLM provider/);
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it('500 (JSON, not a hung request) when the enqueue throws — e.g. the worker never started', async () => {
    const app = makeApp({
      enqueueGuardGenerate: vi
        .fn()
        .mockRejectedValue(new Error('the background job worker is not running')),
    });
    const res = await request(app).post('/api/ee/guard/generate').send({ repoFullName: REPO });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/worker is not running/);
  });

  it('401 without a workspace session', async () => {
    const app = makeApp({ org: null });
    const res = await request(app).post('/api/ee/guard/generate').send({ repoFullName: REPO });
    expect(res.status).toBe(401);
  });

  it('400 on a missing/invalid repoFullName', async () => {
    const app = makeApp({});
    const res = await request(app).post('/api/ee/guard/generate').send({});
    expect(res.status).toBe(400);
  });
});
