/**
 * The spec-change guard checkbox: a spec-changing PR gets a passive checkbox
 * offer (never auto-runs); a writer ticking it enqueues the durable regen+re-gate
 * job for the resolved head. Fakes only the octokit client + the enqueue seam; the
 * FileGateStore is real.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileGateStore,
  handlePullRequestGuardSpecOffer,
  handleCommentEditedGuardSpec,
  renderGuardSpecComment,
  type GuardSpecOfferDeps,
  type GuardSpecRegenRequest,
} from '../../ee/packages/github-app/src/index';

let dir: string;
let store: FileGateStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-spec-'));
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
  configJson?: string | null;
  headRepoFullName?: string;
  headSha?: string;
  headRef?: string;
  permission?: string;
}) {
  const calls = { create: [] as any[], update: [] as any[] };
  const octokit: any = {
    paginate: async (method: any, params: any) => (await method(params)).data,
    pulls: {
      listFiles: async () => ({ data: (opts.files ?? []).map((f) => ({ filename: f })) }),
      get: async () => ({
        data: {
          head: {
            ref: opts.headRef ?? 'feature',
            sha: opts.headSha ?? 'headsha',
            repo: { full_name: opts.headRepoFullName ?? 'acme/api', fork: false },
          },
        },
      }),
    },
    issues: {
      listComments: async () => ({ data: opts.comments ?? [] }),
      createComment: async (p: any) => {
        calls.create.push(p);
        return { data: { id: 8000 } };
      },
      updateComment: async (p: any) => {
        calls.update.push(p);
      },
    },
    repos: {
      getContent: async () => {
        if (opts.configJson == null) throw new Error('not found');
        return { data: opts.configJson };
      },
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
      head: { sha: 'headsha', ref: 'feature', repo: { full_name: 'acme/api', fork: false } },
      base: { sha: 'basesha', ref: 'main' },
    },
    repository: { full_name: 'acme/api', default_branch: 'main' },
    installation: { id: 5 },
    ...over,
  } as any;
}

function offerDeps(
  octokit: any,
  extra: Partial<GuardSpecOfferDeps> = {},
): { deps: GuardSpecOfferDeps; enqueued: GuardSpecRegenRequest[] } {
  const enqueued: GuardSpecRegenRequest[] = [];
  const deps: GuardSpecOfferDeps = {
    store,
    octokitFor: () => octokit,
    enqueueGuardSpecRegen: async (req) => {
      enqueued.push(req);
      return 'job-1';
    },
    ...extra,
  };
  return { deps, enqueued };
}

describe('handlePullRequestGuardSpecOffer (passive offer)', () => {
  it('posts the checkbox offer when the PR changes spec docs — and never runs anything', async () => {
    const { octokit, calls } = makeOctokit({ files: ['docs/spec.md', 'src/app.ts'] });
    const { deps, enqueued } = offerDeps(octokit);

    await handlePullRequestGuardSpecOffer(deps, prPayload());

    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].body).toContain('Spec changed — regenerate guard scenarios?');
    expect(calls.create[0].body).toContain('- [ ] Regenerate guard scenarios for this PR head');
    expect(calls.create[0].body).toContain('docs/spec.md');
    // Passive: nothing enqueued from the offer path.
    expect(enqueued).toHaveLength(0);
  });

  it('does nothing when the PR changes no spec docs (code-only)', async () => {
    const { octokit, calls } = makeOctokit({ files: ['src/app.ts', 'package.json'] });
    const { deps } = offerDeps(octokit);

    await handlePullRequestGuardSpecOffer(deps, prPayload());

    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it('honors the repo spec.include scope — out-of-scope markdown is not a spec change', async () => {
    const { octokit, calls } = makeOctokit({
      files: ['notes/scratch.md'],
      configJson: JSON.stringify({ spec: { include: ['docs/**'] } }),
    });
    const { deps } = offerDeps(octokit);

    await handlePullRequestGuardSpecOffer(deps, prPayload());

    expect(calls.create).toHaveLength(0);
  });

  it('refreshes the existing offer comment on re-sync (no duplicate)', async () => {
    const { octokit, calls } = makeOctokit({
      files: ['docs/spec.md'],
      comments: [{ id: 42, body: renderGuardSpecComment('done', { scenariosWritten: 3 }), user: { type: 'Bot' } }],
    });
    const { deps } = offerDeps(octokit);

    await handlePullRequestGuardSpecOffer(deps, prPayload({ action: 'synchronize' }));

    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].comment_id).toBe(42);
    expect(calls.update[0].body).toContain('- [ ] Regenerate guard scenarios');
  });

  it('drops a concurrent delivery already in flight', async () => {
    const { octokit, calls } = makeOctokit({ files: ['docs/spec.md'] });
    const { deps } = offerDeps(octokit, { offerInFlight: new Set(['acme/api#7#guard-spec']) });

    await handlePullRequestGuardSpecOffer(deps, prPayload());

    expect(calls.create).toHaveLength(0);
  });

  it('no-ops for unconnected / disabled / installation-less payloads', async () => {
    const { octokit, calls } = makeOctokit({ files: ['docs/spec.md'] });
    const { deps } = offerDeps(octokit);

    await handlePullRequestGuardSpecOffer(
      deps,
      prPayload({ repository: { full_name: 'stranger/repo', default_branch: 'main' } }),
    );
    await handlePullRequestGuardSpecOffer(deps, prPayload({ installation: undefined }));
    const link = (await store.getRepo('acme/api'))!;
    await store.linkRepo({ ...link, enabled: false });
    await handlePullRequestGuardSpecOffer(deps, prPayload());

    expect(calls.create).toHaveLength(0);
  });
});

function commentPayload(over: Record<string, unknown> = {}) {
  const checked = renderGuardSpecComment('offered', { specDocs: ['docs/spec.md'] }).replace('- [ ]', '- [x]');
  return {
    action: 'edited',
    comment: { id: 8000, body: checked, user: { type: 'Bot', login: 'tc[bot]' } },
    sender: { login: 'maintainer', type: 'User' },
    issue: { number: 7, pull_request: {} },
    repository: { full_name: 'acme/api' },
    installation: { id: 5 },
    ...over,
  } as any;
}

describe('handleCommentEditedGuardSpec (checkbox tick)', () => {
  it('a writer tick marks the comment running and enqueues regen for the resolved head', async () => {
    const { octokit, calls } = makeOctokit({ permission: 'write', headSha: 'newhead', headRef: 'feat' });
    const { deps, enqueued } = offerDeps(octokit);

    await handleCommentEditedGuardSpec(deps, commentPayload());

    expect(calls.update[0].body).toContain('Regenerating guard scenarios');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toEqual({
      repoFullName: 'acme/api',
      installationId: 5,
      workspaceOrgId: 'org_A',
      prNumber: 7,
      defaultBranch: 'main',
      baseBranch: 'main',
      baseSha: '',
      headRef: 'feat',
      headSha: 'newhead',
      isFork: false,
      commentId: 8000,
    });
  });

  it('resolves isFork from the PR head repo (fork PRs regenerate via the pull ref)', async () => {
    const { octokit } = makeOctokit({ permission: 'write', headRepoFullName: 'forker/api' });
    const { deps, enqueued } = offerDeps(octokit);

    await handleCommentEditedGuardSpec(deps, commentPayload());

    expect(enqueued[0].isFork).toBe(true);
    expect(enqueued[0].repoFullName).toBe('acme/api');
  });

  it('rejects a non-writer trigger (no enqueue, no comment change)', async () => {
    const { octokit, calls } = makeOctokit({ permission: 'read' });
    const { deps, enqueued } = offerDeps(octokit);

    await handleCommentEditedGuardSpec(deps, commentPayload());

    expect(enqueued).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it('ignores an unticked checkbox', async () => {
    const { octokit } = makeOctokit({ permission: 'write' });
    const { deps, enqueued } = offerDeps(octokit);

    await handleCommentEditedGuardSpec(
      deps,
      commentPayload({
        comment: { id: 8000, body: renderGuardSpecComment('offered'), user: { type: 'Bot', login: 'tc[bot]' } },
      }),
    );

    expect(enqueued).toHaveLength(0);
  });

  it('ignores a checked checkbox in some OTHER bot comment (wrong marker)', async () => {
    const { octokit } = makeOctokit({ permission: 'write' });
    const { deps, enqueued } = offerDeps(octokit);

    await handleCommentEditedGuardSpec(
      deps,
      commentPayload({
        comment: {
          id: 1,
          body: 'Unrelated bot comment\n\n- [x] Regenerate guard scenarios for this PR head',
          user: { type: 'Bot', login: 'tc[bot]' },
        },
      }),
    );

    expect(enqueued).toHaveLength(0);
  });

  it('drops a duplicate trigger already in flight', async () => {
    const { octokit } = makeOctokit({ permission: 'write' });
    const { deps, enqueued } = offerDeps(octokit, { inFlight: new Set<number>([8000]) });

    await handleCommentEditedGuardSpec(deps, commentPayload());

    expect(enqueued).toHaveLength(0);
  });

  it('renders an error on the comment when the enqueue throws', async () => {
    const { octokit, calls } = makeOctokit({ permission: 'write' });
    const deps: GuardSpecOfferDeps = {
      store,
      octokitFor: () => octokit,
      enqueueGuardSpecRegen: async () => {
        throw new Error('queue down');
      },
    };

    await handleCommentEditedGuardSpec(deps, commentPayload());

    const last = calls.update[calls.update.length - 1];
    expect(last.body).toContain('Guard regeneration failed');
    expect(last.body).toContain('queue down');
  });
});
