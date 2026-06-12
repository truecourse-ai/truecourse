import express, { type Express } from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createWebhookRouter,
  FileGateStore,
  type BaselineTrigger,
} from '../../ee/packages/github-app/src/index';

const SECRET = 'whsec';

function sign(body: string, secret = SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

let dir: string;
let store: FileGateStore;
let baselineCalls: BaselineTrigger[];
let prCalls: unknown[];
let commentCalls: unknown[];
let app: Express;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-wh-'));
  store = new FileGateStore(dir);
  baselineCalls = [];
  prCalls = [];
  commentCalls = [];
  app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(
    '/api/ee/github',
    createWebhookRouter({
      secret: SECRET,
      store,
      onBaseline: (t) => baselineCalls.push(t),
      onPullRequest: (p) => prCalls.push(p),
      onCommentEdited: (p) => commentCalls.push(p),
    }),
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function post(event: string, payloadObj: unknown, signature?: string) {
  const body = JSON.stringify(payloadObj);
  return request(app)
    .post('/api/ee/github/webhook')
    .set('Content-Type', 'application/json')
    .set('x-github-event', event)
    .set('x-github-delivery', 'test-delivery')
    .set('x-hub-signature-256', signature ?? sign(body))
    .send(body);
}

describe('webhook router', () => {
  it('rejects an invalid signature with 401', async () => {
    await post('push', { ref: 'refs/heads/main' }, 'sha256=bad').expect(401);
  });

  it('saves an installation on installation.created', async () => {
    await post('installation', {
      action: 'created',
      installation: { id: 42, account: { login: 'acme', type: 'Organization' } },
    }).expect(202);

    const rec = await store.getInstallation(42);
    expect(rec?.accountLogin).toBe('acme');
  });

  it('removes an installation (and cascades repos) on installation.deleted', async () => {
    await store.saveInstallation({
      installationId: 7,
      accountLogin: 'acme',
      accountType: 'Organization',
      workspaceOrgId: 'org_A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await store.linkRepo({
      repoFullName: 'acme/api',
      installationId: 7,
      workspaceOrgId: 'org_A',
      defaultBranch: 'main',
      blocking: true,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await post('installation', {
      action: 'deleted',
      installation: { id: 7, account: { login: 'acme', type: 'Organization' } },
    }).expect(202);

    expect(await store.getInstallation(7)).toBeNull();
    expect(await store.getRepo('acme/api')).toBeNull();
  });

  it('triggers a baseline on push to the default branch of a connected repo', async () => {
    await store.linkRepo({
      repoFullName: 'acme/api',
      installationId: 5,
      workspaceOrgId: 'org_A',
      defaultBranch: 'main',
      blocking: true,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await post('push', {
      ref: 'refs/heads/main',
      after: 'sha-after',
      repository: { full_name: 'acme/api', default_branch: 'main' },
      installation: { id: 5 },
    }).expect(202);

    expect(baselineCalls).toHaveLength(1);
    expect(baselineCalls[0]).toMatchObject({
      repoFullName: 'acme/api',
      installationId: 5,
      defaultBranch: 'main',
      commitSha: 'sha-after',
    });
  });

  it('ignores a push to a non-default branch', async () => {
    await store.linkRepo({
      repoFullName: 'acme/api',
      installationId: 5,
      workspaceOrgId: 'org_A',
      defaultBranch: 'main',
      blocking: true,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await post('push', {
      ref: 'refs/heads/feature',
      after: 'x',
      repository: { full_name: 'acme/api', default_branch: 'main' },
      installation: { id: 5 },
    }).expect(202);

    expect(baselineCalls).toHaveLength(0);
  });

  it('ignores a push to an unconnected repo', async () => {
    await post('push', {
      ref: 'refs/heads/main',
      after: 'x',
      repository: { full_name: 'stranger/repo', default_branch: 'main' },
      installation: { id: 9 },
    }).expect(202);

    expect(baselineCalls).toHaveLength(0);
  });

  it('routes pull_request to onPullRequest', async () => {
    await post('pull_request', {
      action: 'opened',
      number: 3,
      repository: { full_name: 'acme/api', default_branch: 'main' },
      installation: { id: 5 },
    }).expect(202);
    expect(prCalls).toHaveLength(1);
  });

  it('routes issue_comment to onCommentEdited', async () => {
    await post('issue_comment', {
      action: 'edited',
      comment: { id: 1, body: 'hi', user: { type: 'Bot', login: 'tc[bot]' } },
      issue: { number: 3, pull_request: {} },
      repository: { full_name: 'acme/api' },
      installation: { id: 5 },
    }).expect(202);
    expect(commentCalls).toHaveLength(1);
  });
});
