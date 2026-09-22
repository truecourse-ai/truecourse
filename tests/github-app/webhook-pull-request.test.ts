/**
 * The pull request half of the webhook: every `pull_request` action writes
 * the row as GitHub last saw it and tells the host what that means for the
 * check — judge the head, hold a draft, close — and a "re-run" pressed on
 * GitHub names the check (or the head) to judge again. Events for a
 * repository nobody connected or reads are acknowledged and dropped, and a
 * repository only a context source reads still gets its row, under that
 * workspace.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createWebhookRouter,
  type CheckRerunTrigger,
  type PullRequestTrigger,
} from '../../packages/github-app/src/index';
import type { RepositoryRecord } from '@truecourse/shared';
import { MemoryInstallationStore, seedInstallation } from './memory-store';
import { memoryPullRequestStore, type MemoryPullRequestStore } from '../helpers/memory-pull-requests';

const SECRET = 'whsec';
const sign = (body: string): string =>
  'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

let store: MemoryInstallationStore;
let pulls: MemoryPullRequestStore;
let sourceWorkspaces: Map<string, string>;
let triggers: PullRequestTrigger[];
let reruns: CheckRerunTrigger[];
let app: Express;

beforeEach(async () => {
  store = new MemoryInstallationStore();
  pulls = memoryPullRequestStore();
  sourceWorkspaces = new Map();
  triggers = [];
  reruns = [];
  app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(
    '/api/github',
    createWebhookRouter({
      secret: SECRET,
      store,
      repos: store,
      pulls,
      sourceWorkspaceOf: async (repoFullName) => sourceWorkspaces.get(repoFullName) ?? null,
      onBaseline: () => {},
      onPullRequest: (t) => triggers.push(t),
      onCheckRerun: (t) => reruns.push(t),
    }),
  );
  await seedInstallation(store, 5, ['org_A']);
  await store.linkRepo(repoLink('acme/api', 5));
});

function repoLink(repoFullName: string, installationId: number): RepositoryRecord {
  return {
    repoFullName,
    provider: 'github',
    accountId: String(installationId),
    workspaceOrgId: 'org_A',
    slug: 'api',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function post(event: string, payloadObj: unknown) {
  const body = JSON.stringify(payloadObj);
  return request(app)
    .post('/api/github/webhook')
    .set('Content-Type', 'application/json')
    .set('x-github-event', event)
    .set('x-hub-signature-256', sign(body))
    .send(body);
}

/** A pull_request payload as GitHub sends one, with the fields that vary overridable. */
function pullRequest(
  action: string,
  over: {
    number?: number;
    repo?: string;
    headRepo?: string | null;
    draft?: boolean;
    state?: 'open' | 'closed';
    merged?: boolean;
    headSha?: string;
    title?: string;
    changes?: unknown;
  } = {},
) {
  const repo = over.repo ?? 'acme/api';
  return {
    action,
    number: over.number ?? 7,
    pull_request: {
      number: over.number ?? 7,
      title: over.title ?? 'Add widgets',
      state: over.state ?? 'open',
      draft: over.draft ?? false,
      merged: over.merged ?? false,
      user: { login: 'octocat' },
      head: {
        sha: over.headSha ?? 'head-1',
        ref: 'feature/widgets',
        repo: over.headRepo === undefined ? { full_name: repo } : over.headRepo === null ? null : { full_name: over.headRepo },
      },
      base: { ref: 'main', repo: { full_name: repo } },
      created_at: '2026-09-20T10:00:00Z',
      closed_at: over.state === 'closed' ? '2026-09-21T10:00:00Z' : null,
      updated_at: '2026-09-21T09:00:00Z',
    },
    ...(over.changes ? { changes: over.changes } : {}),
    repository: { full_name: repo },
    installation: { id: 5 },
  };
}

describe('pull_request events', () => {
  it('writes the row and asks for a check when a pull request opens', async () => {
    await post('pull_request', pullRequest('opened')).expect(202);
    const pr = await pulls.getPullRequest('acme/api', 7);
    expect(pr).toMatchObject({
      workspaceOrgId: 'org_A',
      provider: 'github',
      title: 'Add widgets',
      authorLogin: 'octocat',
      headSha: 'head-1',
      headRef: 'feature/widgets',
      baseRef: 'main',
      headRepoFullName: 'acme/api',
      draft: false,
      state: 'open',
      openedAt: '2026-09-20T10:00:00.000Z',
      closedAt: null,
    });
    expect(triggers).toEqual([{ pr, installationId: 5, effect: 'check' }]);
  });

  it.each([
    ['reopened', 'check'],
    ['synchronize', 'check'],
    ['ready_for_review', 'check'],
    ['converted_to_draft', 'draft'],
  ] as const)('%s → %s', async (action, effect) => {
    await post('pull_request', pullRequest(action, { draft: effect === 'draft' })).expect(202);
    expect(triggers.map((t) => t.effect)).toEqual([effect]);
  });

  it('holds a draft rather than checking it, on open and on every push to it', async () => {
    await post('pull_request', pullRequest('opened', { draft: true })).expect(202);
    await post('pull_request', pullRequest('synchronize', { draft: true, headSha: 'head-2' })).expect(202);
    expect(triggers.map((t) => t.effect)).toEqual(['draft', 'draft']);
    expect((await pulls.getPullRequest('acme/api', 7))?.headSha).toBe('head-2');
  });

  it('moves the head on synchronize and asks for a check of the new one', async () => {
    await post('pull_request', pullRequest('opened')).expect(202);
    await post('pull_request', pullRequest('synchronize', { headSha: 'head-2' })).expect(202);
    expect((await pulls.getPullRequest('acme/api', 7))?.headSha).toBe('head-2');
    expect(triggers.map((t) => [t.effect, t.pr.headSha])).toEqual([
      ['check', 'head-1'],
      ['check', 'head-2'],
    ]);
  });

  it('an edit moves the title and asks for nothing, unless the base changed', async () => {
    await post('pull_request', pullRequest('opened')).expect(202);
    await post('pull_request', pullRequest('edited', { title: 'Add gadgets' })).expect(202);
    expect((await pulls.getPullRequest('acme/api', 7))?.title).toBe('Add gadgets');
    expect(triggers.map((t) => t.effect)).toEqual(['check', 'none']);
    await post(
      'pull_request',
      pullRequest('edited', { changes: { base: { ref: { from: 'develop' } } } }),
    ).expect(202);
    expect(triggers.at(-1)?.effect).toBe('check');
  });

  it('closes: merged when merged, closed otherwise', async () => {
    await post('pull_request', pullRequest('opened')).expect(202);
    await post('pull_request', pullRequest('closed', { state: 'closed', merged: true })).expect(202);
    expect(await pulls.getPullRequest('acme/api', 7)).toMatchObject({
      state: 'merged',
      closedAt: '2026-09-21T10:00:00.000Z',
    });
    await post('pull_request', pullRequest('closed', { number: 8, state: 'closed' })).expect(202);
    expect((await pulls.getPullRequest('acme/api', 8))?.state).toBe('closed');
    expect(triggers.map((t) => t.effect)).toEqual(['check', 'close', 'close']);
  });

  it('records a fork by the head repository, and a deleted fork as none', async () => {
    await post('pull_request', pullRequest('opened', { headRepo: 'octocat/api' })).expect(202);
    expect((await pulls.getPullRequest('acme/api', 7))?.headRepoFullName).toBe('octocat/api');
    await post('pull_request', pullRequest('opened', { number: 9, headRepo: null })).expect(202);
    expect((await pulls.getPullRequest('acme/api', 9))?.headRepoFullName).toBeNull();
  });

  it('ignores an action that changes nothing about the check', async () => {
    await post('pull_request', pullRequest('labeled')).expect(202);
    expect(await pulls.getPullRequest('acme/api', 7)).toBeNull();
    expect(triggers).toEqual([]);
  });

  it('drops a pull request of a repository nobody connected or reads', async () => {
    await post('pull_request', pullRequest('opened', { repo: 'stranger/repo' })).expect(202);
    expect(pulls.pullRequests).toEqual([]);
    expect(triggers).toEqual([]);
  });

  it('keeps a pull request of a repository a context source reads, under that workspace', async () => {
    await seedInstallation(store, 5, ['org_A', 'org_B']);
    sourceWorkspaces.set('acme/handbook', 'org_B');
    await post('pull_request', pullRequest('opened', { repo: 'acme/handbook' })).expect(202);
    expect((await pulls.getPullRequest('acme/handbook', 7))?.workspaceOrgId).toBe('org_B');
    expect(triggers).toHaveLength(1);
  });

  it('drops one whose workspace does not hold the installation it came through', async () => {
    sourceWorkspaces.set('acme/handbook', 'org_C');
    await post('pull_request', pullRequest('opened', { repo: 'acme/handbook' })).expect(202);
    // And a connected repository's, when it came through another installation.
    await store.linkRepo({ ...repoLink('acme/web', 6), slug: 'web' });
    await post('pull_request', pullRequest('opened', { repo: 'acme/web' })).expect(202);
    expect(pulls.pullRequests).toEqual([]);
  });

  it('is acknowledged and ignored when no pull request store is wired', async () => {
    const bare = express();
    bare.use(express.json({ verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; } }));
    bare.use(
      '/api/github',
      createWebhookRouter({
        secret: SECRET,
        store,
        repos: store,
        sourceWorkspaceOf: async () => null,
        onBaseline: () => {},
        onPullRequest: (t) => triggers.push(t),
      }),
    );
    const body = JSON.stringify(pullRequest('opened'));
    await request(bare)
      .post('/api/github/webhook')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(202);
    expect(triggers).toEqual([]);
  });
});

describe('re-runs asked for on GitHub', () => {
  it('names our check on a check_run re-run', async () => {
    await post('check_run', {
      action: 'rerequested',
      check_run: { external_id: 'check_42', head_sha: 'head-1' },
      repository: { full_name: 'acme/api' },
      installation: { id: 5 },
    }).expect(202);
    expect(reruns).toEqual([
      { repoFullName: 'acme/api', workspaceOrgId: 'org_A', installationId: 5, headSha: 'head-1', checkId: 'check_42' },
    ]);
  });

  it('names the whole head on a check_suite re-run', async () => {
    await post('check_suite', {
      action: 'rerequested',
      check_suite: { head_sha: 'head-1' },
      repository: { full_name: 'acme/api' },
      installation: { id: 5 },
    }).expect(202);
    expect(reruns).toEqual([
      { repoFullName: 'acme/api', workspaceOrgId: 'org_A', installationId: 5, headSha: 'head-1', checkId: null },
    ]);
  });

  it('ignores every other check_run action, and an unknown repository', async () => {
    await post('check_run', {
      action: 'completed',
      check_run: { external_id: 'check_42', head_sha: 'head-1' },
      repository: { full_name: 'acme/api' },
      installation: { id: 5 },
    }).expect(202);
    await post('check_suite', {
      action: 'rerequested',
      check_suite: { head_sha: 'head-1' },
      repository: { full_name: 'stranger/repo' },
      installation: { id: 5 },
    }).expect(202);
    expect(reruns).toEqual([]);
  });
});

describe('installation permissions', () => {
  it('are stored from the installation event and kept when a later event carries none', async () => {
    await post('installation', {
      action: 'created',
      installation: {
        id: 9,
        account: { login: 'acme', type: 'Organization' },
        permissions: { checks: 'write', pull_requests: 'read' },
      },
    }).expect(202);
    expect((await store.getInstallation(9))?.permissions).toEqual({ checks: 'write', pull_requests: 'read' });
    await post('installation', {
      action: 'suspend',
      installation: { id: 9, account: { login: 'acme', type: 'Organization' } },
    }).expect(202);
    expect((await store.getInstallation(9))?.permissions).toEqual({ checks: 'write', pull_requests: 'read' });
    await post('installation', {
      action: 'new_permissions_accepted',
      installation: {
        id: 9,
        account: { login: 'acme', type: 'Organization' },
        permissions: { checks: 'write', pull_requests: 'write' },
      },
    }).expect(202);
    expect((await store.getInstallation(9))?.permissions).toEqual({ checks: 'write', pull_requests: 'write' });
  });
});
