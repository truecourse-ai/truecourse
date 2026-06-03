import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileGateStore,
  handlePullRequestInferOffer,
  handleCommentEditedInfer,
  renderInferComment,
  INFER_MARKER,
  type InferOfferDeps,
} from '../../ee/packages/github-app/src/index';

let dir: string;
let store: FileGateStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-infer-'));
  store = new FileGateStore(dir);
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
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeOctokit(opts: {
  files?: string[];
  comments?: { id: number; body: string; user?: { type: string } }[];
  headRepoFullName?: string;
  permission?: string;
}) {
  const calls = { create: [] as any[], update: [] as any[] };
  const octokit: any = {
    paginate: async (method: any, params: any) => (await method(params)).data,
    pulls: {
      listFiles: async () => ({
        data: (opts.files ?? []).map((f) => ({ filename: f })),
      }),
      get: async () => ({
        data: {
          head: {
            ref: 'feature',
            sha: 'headsha',
            repo: { full_name: opts.headRepoFullName ?? 'acme/api', fork: false },
          },
        },
      }),
    },
    issues: {
      listComments: async () => ({ data: opts.comments ?? [] }),
      createComment: async (p: any) => {
        calls.create.push(p);
        return { data: { id: 7000 } };
      },
      updateComment: async (p: any) => {
        calls.update.push(p);
      },
    },
    repos: {
      getCollaboratorPermissionLevel: async () => ({
        data: { permission: opts.permission ?? 'write' },
      }),
    },
  };
  return { octokit, calls };
}

function prPayload(over: Record<string, unknown> = {}) {
  return {
    action: 'opened',
    number: 7,
    pull_request: {
      head: { sha: 'h', ref: 'feature', repo: { full_name: 'acme/api', fork: false } },
      base: { sha: 'b', ref: 'main' },
    },
    repository: { full_name: 'acme/api', default_branch: 'main' },
    installation: { id: 5 },
    ...over,
  } as any;
}

const botComment = (id: number, body: string) => ({ id, body, user: { type: 'Bot' } });

/** A capturing fake notifier; pushes happen synchronously at call time. */
function makeNotifier() {
  const calls = { scan: [] as any[], infer: [] as any[], gate: [] as any[] };
  const notifier: any = {
    sendGateFailure: async (to: string[], email: any) => { calls.gate.push({ to, email }); },
    sendScanOffer: async (to: string[], email: any) => { calls.scan.push({ to, email }); },
    sendInferResult: async (to: string[], email: any) => { calls.infer.push({ to, email }); },
  };
  return { notifier, calls };
}

/** Re-link acme/api with a notify list (linkRepo upserts). */
async function setNotifyEmails(s: FileGateStore, emails: string[]) {
  await s.linkRepo({
    repoFullName: 'acme/api',
    installationId: 5,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    notifyEmails: emails,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('handlePullRequestInferOffer', () => {
  it('offers inference when the PR changes code', async () => {
    const { octokit, calls } = makeOctokit({ files: ['src/app.ts', 'README.md'] });
    const deps = { store, octokitFor: () => octokit } as unknown as InferOfferDeps;
    await handlePullRequestInferOffer(deps, prPayload());
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].body).toContain(INFER_MARKER);
  });

  it('does nothing when only docs changed', async () => {
    const { octokit, calls } = makeOctokit({ files: ['docs/spec.md'] });
    const deps = { store, octokitFor: () => octokit } as unknown as InferOfferDeps;
    await handlePullRequestInferOffer(deps, prPayload());
    expect(calls.create).toHaveLength(0);
  });

  it('does not clobber a done infer comment on synchronize', async () => {
    const { octokit, calls } = makeOctokit({
      files: ['src/app.ts'],
      comments: [botComment(99, renderInferComment('done', { decisions: [] }))],
    });
    const deps = { store, octokitFor: () => octokit } as unknown as InferOfferDeps;
    await handlePullRequestInferOffer(deps, prPayload({ action: 'synchronize' }));
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it('posts a fork comment for fork PRs', async () => {
    const { octokit, calls } = makeOctokit({ files: ['src/app.ts'] });
    const deps = { store, octokitFor: () => octokit } as unknown as InferOfferDeps;
    await handlePullRequestInferOffer(
      deps,
      prPayload({
        pull_request: {
          head: { sha: 'h', ref: 'feature', repo: { full_name: 'forker/api', fork: true } },
          base: { sha: 'b', ref: 'main' },
        },
      }),
    );
    expect(calls.create[0].body).toContain('Fork PR');
  });

  it('drops a concurrent offer delivery already in flight', async () => {
    const { octokit, calls } = makeOctokit({ files: ['src/app.ts'] });
    const deps = {
      store,
      octokitFor: () => octokit,
      offerInFlight: new Set<string>(['acme/api#7#infer']),
    } as unknown as InferOfferDeps;
    await handlePullRequestInferOffer(deps, prPayload());
    expect(calls.create).toHaveLength(0);
  });
});

function commentPayload(over: Record<string, unknown> = {}) {
  const checked = renderInferComment('offered').replace('- [ ]', '- [x]');
  return {
    action: 'edited',
    comment: { id: 7000, body: checked, user: { type: 'Bot', login: 'tc[bot]' } },
    sender: { login: 'maintainer', type: 'User' },
    issue: { number: 7, pull_request: {} },
    repository: { full_name: 'acme/api' },
    installation: { id: 5 },
    ...over,
  } as any;
}

describe('handleCommentEditedInfer', () => {
  function depsWith(octokit: any, runInfer: any, extra: Record<string, unknown> = {}) {
    return { store, octokitFor: () => octokit, runInfer, ...extra } as unknown as InferOfferDeps;
  }

  it('runs inference and lists decisions when a writer checks the box', async () => {
    const { octokit, calls } = makeOctokit({ permission: 'write' });
    let inferCalls = 0;
    const deps = depsWith(octokit, async () => {
      inferCalls++;
      return {
        decisions: [{ kind: 'Operation', identity: 'GET /x' }],
        commitSha: 'deadbeef',
      };
    });
    await handleCommentEditedInfer(deps, commentPayload());
    expect(inferCalls).toBe(1);
    expect(calls.update[0].body).toContain('Inferring');
    expect(calls.update[1].body).toContain('1 undocumented decision');
    expect(calls.update[1].body).toContain('GET /x');
  });

  it('reports "no undocumented decisions" when none found', async () => {
    const { octokit, calls } = makeOctokit({});
    const deps = depsWith(octokit, async () => ({
      decisions: [],
      commitSha: 'deadbeef',
    }));
    await handleCommentEditedInfer(deps, commentPayload());
    expect(calls.update[1].body).toContain('No undocumented decisions');
  });

  it('stores inferred contracts server-side and never claims a branch commit', async () => {
    const { octokit, calls } = makeOctokit({});
    const deps = depsWith(octokit, async () => ({
      decisions: [{ kind: 'Operation', identity: 'GET /x' }],
      commitSha: 'cafe1234',
    }));
    await handleCommentEditedInfer(deps, commentPayload());
    expect(calls.update[1].body).not.toMatch(/Committed inferred contracts/);
    expect(calls.update[1].body).toContain('Stored inferred contracts in TrueCourse');
    expect(calls.update[1].body).toMatch(/Nothing was committed/i);
    expect(calls.update[1].body).toContain('cafe123'); // the stored head commit
  });

  it('reports "no undocumented decisions" when none are found (0 decisions)', async () => {
    const { octokit, calls } = makeOctokit({});
    const deps = depsWith(octokit, async () => ({
      decisions: [],
      commitSha: 'cafe1234',
    }));
    await handleCommentEditedInfer(deps, commentPayload());
    expect(calls.update[1].body).toContain('No undocumented decisions');
    expect(calls.update[1].body).not.toMatch(/Committed/);
  });

  it('rejects a non-writer trigger', async () => {
    const { octokit, calls } = makeOctokit({ permission: 'read' });
    let inferCalls = 0;
    const deps = depsWith(octokit, async () => {
      inferCalls++;
      return { decisions: [], commitSha: 'deadbeef' };
    });
    await handleCommentEditedInfer(deps, commentPayload());
    expect(inferCalls).toBe(0);
    expect(calls.update).toHaveLength(0);
  });

  it('renders a fork comment and skips inference for a fork PR', async () => {
    const { octokit, calls } = makeOctokit({ headRepoFullName: 'forker/api' });
    let inferCalls = 0;
    const deps = depsWith(octokit, async () => {
      inferCalls++;
      return { decisions: [], commitSha: 'deadbeef' };
    });
    await handleCommentEditedInfer(deps, commentPayload());
    expect(inferCalls).toBe(0);
    expect(calls.update[0].body).toContain('Fork PR');
  });

  it('ignores a scan comment (wrong marker)', async () => {
    const { octokit, calls } = makeOctokit({});
    let inferCalls = 0;
    const deps = depsWith(octokit, async () => {
      inferCalls++;
      return { decisions: [], commitSha: 'deadbeef' };
    });
    // A checked SCAN comment must not trigger the infer handler.
    const { renderScanComment } = await import('../../ee/packages/github-app/src/index');
    await handleCommentEditedInfer(
      deps,
      commentPayload({
        comment: {
          id: 1,
          body: renderScanComment('offered').replace('- [ ]', '- [x]'),
          user: { type: 'Bot', login: 'tc[bot]' },
        },
      }),
    );
    expect(inferCalls).toBe(0);
    expect(calls.update).toHaveLength(0);
  });

  it('drops a duplicate trigger already in flight', async () => {
    const { octokit } = makeOctokit({});
    let inferCalls = 0;
    const deps = depsWith(
      octokit,
      async () => {
        inferCalls++;
        return { decisions: [], commitSha: 'deadbeef' };
      },
      { inFlight: new Set<number>([7000]) },
    );
    await handleCommentEditedInfer(deps, commentPayload());
    expect(inferCalls).toBe(0);
  });

  it('emails the notify list when inference finds new decisions', async () => {
    await setNotifyEmails(store, ['a@x.com', 'b@y.com']);
    const { octokit } = makeOctokit({ permission: 'write' });
    const { notifier, calls } = makeNotifier();
    const deps = depsWith(
      octokit,
      async () => ({
        decisions: [{ kind: 'Operation', identity: 'GET /x' }],
        commitSha: 'deadbeef',
      }),
      { notifier },
    );
    await handleCommentEditedInfer(deps, commentPayload());
    expect(calls.infer).toHaveLength(1);
    expect(calls.infer[0].to).toEqual(['a@x.com', 'b@y.com']);
    expect(calls.infer[0].email.commitSha).toBe('deadbeef');
    expect(calls.infer[0].email.decisions).toHaveLength(1);
  });

  it('does NOT email on a no-change inference run', async () => {
    await setNotifyEmails(store, ['a@x.com']);
    const { octokit } = makeOctokit({ permission: 'write' });
    const { notifier, calls } = makeNotifier();
    const deps = depsWith(
      octokit,
      async () => ({ decisions: [], commitSha: 'deadbeef' }),
      { notifier },
    );
    await handleCommentEditedInfer(deps, commentPayload());
    expect(calls.infer).toHaveLength(0);
  });
});
