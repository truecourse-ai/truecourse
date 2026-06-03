import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileGateStore,
  handlePullRequestSpecOffer,
  handleCommentEditedScan,
  renderScanComment,
  SCAN_MARKER,
  type SpecOfferDeps,
} from '../../ee/packages/github-app/src/index';

let dir: string;
let store: FileGateStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-offer-'));
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
  const calls = { create: [] as any[], update: [] as any[], perm: [] as any[] };
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
        return { data: { id: 4242 } };
      },
      updateComment: async (p: any) => {
        calls.update.push(p);
      },
    },
    repos: {
      getCollaboratorPermissionLevel: async (p: any) => {
        calls.perm.push(p);
        return { data: { permission: opts.permission ?? 'write' } };
      },
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

describe('handlePullRequestSpecOffer', () => {
  it('posts an offer comment when the PR changes spec docs', async () => {
    const { octokit, calls } = makeOctokit({ files: ['src/a.ts', 'docs/spec.md'] });
    const deps = { store, octokitFor: () => octokit } as unknown as SpecOfferDeps;

    await handlePullRequestSpecOffer(deps, prPayload());
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].body).toContain(SCAN_MARKER);
    expect(calls.create[0].body).toContain('docs/spec.md');
  });

  it('does nothing when no spec docs changed', async () => {
    const { octokit, calls } = makeOctokit({ files: ['src/a.ts'] });
    const deps = { store, octokitFor: () => octokit } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(deps, prPayload());
    expect(calls.create).toHaveLength(0);
  });

  it('refreshes an existing OFFERED comment', async () => {
    const { octokit, calls } = makeOctokit({
      files: ['docs/spec.md'],
      comments: [botComment(99, renderScanComment('offered'))],
    });
    const deps = { store, octokitFor: () => octokit } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(deps, prPayload());
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].comment_id).toBe(99);
  });

  it('does NOT clobber a running/done comment on synchronize', async () => {
    const { octokit, calls } = makeOctokit({
      files: ['docs/spec.md'],
      comments: [botComment(99, renderScanComment('done', { changedContracts: ['a.tc'] }))],
    });
    const deps = { store, octokitFor: () => octokit } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(deps, prPayload({ action: 'synchronize' }));
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it('ignores non-offer actions like closed', async () => {
    const { octokit, calls } = makeOctokit({ files: ['docs/spec.md'] });
    const deps = { store, octokitFor: () => octokit } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(deps, prPayload({ action: 'closed' }));
    expect(calls.create).toHaveLength(0);
  });

  it('posts a fork-unsupported comment for a fork PR', async () => {
    const { octokit, calls } = makeOctokit({ files: ['docs/spec.md'] });
    const deps = { store, octokitFor: () => octokit } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(
      deps,
      prPayload({
        pull_request: {
          head: { sha: 'h', ref: 'feature', repo: { full_name: 'forker/api', fork: true } },
          base: { sha: 'b', ref: 'main' },
        },
      }),
    );
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].body).toContain('Fork PR');
    expect(calls.create[0].body).not.toContain('[ ] Run TrueCourse');
  });

  it('ignores PRs on unconnected repos', async () => {
    const { octokit, calls } = makeOctokit({ files: ['docs/spec.md'] });
    const deps = { store, octokitFor: () => octokit } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(
      deps,
      prPayload({ repository: { full_name: 'stranger/repo', default_branch: 'main' } }),
    );
    expect(calls.create).toHaveLength(0);
  });

  it('emails the notify list once, when a new offer is first posted', async () => {
    await setNotifyEmails(store, ['a@x.com', 'b@y.com']);
    const { octokit } = makeOctokit({ files: ['docs/spec.md', 'src/a.ts'] });
    const { notifier, calls } = makeNotifier();
    const deps = { store, octokitFor: () => octokit, notifier } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(deps, prPayload());
    expect(calls.scan).toHaveLength(1);
    expect(calls.scan[0].to).toEqual(['a@x.com', 'b@y.com']);
    expect(calls.scan[0].email.specDocs).toEqual(['docs/spec.md']);
    expect(calls.scan[0].email.prNumber).toBe(7);
  });

  it('does NOT email when refreshing an already-offered comment', async () => {
    await setNotifyEmails(store, ['a@x.com']);
    const { octokit } = makeOctokit({
      files: ['docs/spec.md'],
      comments: [botComment(99, renderScanComment('offered'))],
    });
    const { notifier, calls } = makeNotifier();
    const deps = { store, octokitFor: () => octokit, notifier } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(deps, prPayload({ action: 'synchronize' }));
    expect(calls.scan).toHaveLength(0);
  });

  it('does NOT email for a fork PR offer', async () => {
    await setNotifyEmails(store, ['a@x.com']);
    const { octokit } = makeOctokit({ files: ['docs/spec.md'] });
    const { notifier, calls } = makeNotifier();
    const deps = { store, octokitFor: () => octokit, notifier } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(
      deps,
      prPayload({
        pull_request: {
          head: { sha: 'h', ref: 'feature', repo: { full_name: 'forker/api', fork: true } },
          base: { sha: 'b', ref: 'main' },
        },
      }),
    );
    expect(calls.scan).toHaveLength(0);
  });

  it('does NOT email when the repo has no notify list', async () => {
    const { octokit } = makeOctokit({ files: ['docs/spec.md'] });
    const { notifier, calls } = makeNotifier();
    const deps = { store, octokitFor: () => octokit, notifier } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(deps, prPayload());
    expect(calls.scan).toHaveLength(0);
  });

  it('drops a concurrent delivery already in flight (no duplicate comment/email)', async () => {
    await setNotifyEmails(store, ['a@x.com']);
    const { octokit, calls } = makeOctokit({ files: ['docs/spec.md'] });
    const { notifier, calls: ncalls } = makeNotifier();
    const deps = {
      store,
      octokitFor: () => octokit,
      notifier,
      offerInFlight: new Set<string>(['acme/api#7#scan']),
    } as unknown as SpecOfferDeps;
    await handlePullRequestSpecOffer(deps, prPayload());
    expect(calls.create).toHaveLength(0);
    expect(ncalls.scan).toHaveLength(0);
  });
});

function commentPayload(over: Record<string, unknown> = {}) {
  const checked = renderScanComment('offered', { specDocs: ['docs/spec.md'] }).replace(
    '- [ ]',
    '- [x]',
  );
  return {
    action: 'edited',
    comment: { id: 4242, body: checked, user: { type: 'Bot', login: 'tc[bot]' } },
    sender: { login: 'maintainer', type: 'User' },
    issue: { number: 7, pull_request: {} },
    repository: { full_name: 'acme/api' },
    installation: { id: 5 },
    ...over,
  } as any;
}

describe('handleCommentEditedScan', () => {
  function depsWith(octokit: any, runScan: any, extra: Record<string, unknown> = {}) {
    return { store, octokitFor: () => octokit, runScan, ...extra } as unknown as SpecOfferDeps;
  }

  it('runs the scan and reports success when a writer checks the box', async () => {
    const { octokit, calls } = makeOctokit({ permission: 'write' });
    let scanCalls = 0;
    const deps = depsWith(octokit, async () => {
      scanCalls++;
      return { savedFileCount: 1, commitSha: 'deadbeef' };
    });
    await handleCommentEditedScan(deps, commentPayload());
    expect(scanCalls).toBe(1);
    expect(calls.update[0].body).toContain('Running');
    expect(calls.update[1].body).toContain('Contracts regenerated');
  });

  it('reports "no changes" when the scan produced nothing', async () => {
    const { octokit, calls } = makeOctokit({});
    const deps = depsWith(octokit, async () => ({ savedFileCount: 0, commitSha: 'deadbeef' }));
    await handleCommentEditedScan(deps, commentPayload());
    expect(calls.update[1].body).toContain('no contracts produced');
  });

  it('flags unresolved conflicts in the success comment so a human resolves them', async () => {
    const { octokit, calls } = makeOctokit({ permission: 'write' });
    const deps = depsWith(octokit, async () => ({
      savedFileCount: 2,
      commitSha: 'deadbeef',
      openConflicts: 3,
    }));
    await handleCommentEditedScan(deps, commentPayload());
    const done = calls.update[1].body;
    expect(done).toContain('Contracts regenerated');
    expect(done).toContain('3 unresolved spec conflicts');
    expect(done).toMatch(/drift gate stays neutral/i);
  });

  it('reports an error when the scan throws', async () => {
    const { octokit, calls } = makeOctokit({});
    const deps = depsWith(octokit, async () => {
      throw new Error('LLM exploded');
    });
    await handleCommentEditedScan(deps, commentPayload());
    expect(calls.update[1].body).toContain('Scan failed');
    expect(calls.update[1].body).toContain('LLM exploded');
  });

  it('rejects a trigger from a non-writer (read permission)', async () => {
    const { octokit, calls } = makeOctokit({ permission: 'read' });
    let scanCalls = 0;
    const deps = depsWith(octokit, async () => {
      scanCalls++;
      return { savedFileCount: 0, commitSha: 'deadbeef' };
    });
    await handleCommentEditedScan(deps, commentPayload());
    expect(scanCalls).toBe(0);
    expect(calls.update).toHaveLength(0);
  });

  it('renders a fork comment and skips the scan for a fork PR', async () => {
    const { octokit, calls } = makeOctokit({ headRepoFullName: 'forker/api' });
    let scanCalls = 0;
    const deps = depsWith(octokit, async () => {
      scanCalls++;
      return { savedFileCount: 0, commitSha: 'deadbeef' };
    });
    await handleCommentEditedScan(deps, commentPayload());
    expect(scanCalls).toBe(0);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].body).toContain('Fork PR');
  });

  it('drops a duplicate trigger already in flight', async () => {
    const { octokit } = makeOctokit({});
    let scanCalls = 0;
    const deps = depsWith(
      octokit,
      async () => {
        scanCalls++;
        return { savedFileCount: 0, commitSha: 'deadbeef' };
      },
      { inFlight: new Set<number>([4242]) },
    );
    await handleCommentEditedScan(deps, commentPayload());
    expect(scanCalls).toBe(0);
  });

  it('ignores a checked box on a non-bot (forged) comment', async () => {
    const { octokit, calls } = makeOctokit({});
    let scanCalls = 0;
    const deps = depsWith(octokit, async () => {
      scanCalls++;
      return { savedFileCount: 0, commitSha: 'deadbeef' };
    });
    await handleCommentEditedScan(
      deps,
      commentPayload({
        comment: {
          id: 1,
          body: renderScanComment('offered').replace('- [ ]', '- [x]'),
          user: { type: 'User', login: 'attacker' },
        },
      }),
    );
    expect(scanCalls).toBe(0);
    expect(calls.update).toHaveLength(0);
  });

  it('ignores an unchecked box and non-PR comments', async () => {
    const { octokit, calls } = makeOctokit({});
    let scanCalls = 0;
    const deps = depsWith(octokit, async () => {
      scanCalls++;
      return { savedFileCount: 0, commitSha: 'deadbeef' };
    });
    await handleCommentEditedScan(
      deps,
      commentPayload({
        comment: {
          id: 4242,
          body: renderScanComment('offered'),
          user: { type: 'Bot', login: 'tc[bot]' },
        },
      }),
    );
    await handleCommentEditedScan(deps, commentPayload({ issue: { number: 7 } }));
    expect(scanCalls).toBe(0);
    expect(calls.update).toHaveLength(0);
  });
});
