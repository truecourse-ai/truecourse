/**
 * The Checks API client: the one check run per pull request check, its
 * summary rendered from the report (counts first, capped at what GitHub
 * takes), and its annotations on the changed documents' lines, fifty per
 * request. A fake Octokit records what would be sent.
 */
import { describe, it, expect } from 'vitest';
import type { PullRequestCheckReport } from '@truecourse/shared';
import {
  CHECK_NAME,
  createCheck,
  renderCheckOutput,
  updateCheck,
} from '../../packages/github-app/src/index';
import type { OctokitClient } from '../../packages/github-app/src/octokit';

function fakeOctokit() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const octokit = {
    checks: {
      create: async (params: Record<string, unknown>) => {
        calls.push({ method: 'create', params });
        return { data: { id: 4242 } };
      },
      update: async (params: Record<string, unknown>) => {
        calls.push({ method: 'update', params });
        return { data: { id: 4242 } };
      },
    },
  } as unknown as OctokitClient;
  return { octokit, calls };
}

const report = (over: Partial<PullRequestCheckReport> = {}): PullRequestCheckReport => ({
  base: { mergeBase: 'b'.repeat(40), commit: 'b'.repeat(40), nearestWithBase: null },
  fork: false,
  conflictsCreated: [],
  sectionsMoved: [],
  repositoriesAffected: [],
  run: {
    runId: 'run-1',
    counts: { newFailures: 1, preExisting: 2, fixed: 0, newlyBlocked: 0, added: 0, retired: 0 },
    newFailures: [{ id: 'f1', title: 'Checkout completes', scenarioIds: ['s1'], label: 'bug' }],
    preExisting: [{ id: 'f2', title: 'Login' }, { id: 'f3', title: 'Logout' }],
    fixed: [],
    newlyBlocked: [],
  },
  specHalf: 'no-documents-changed',
  codeHalf: 'ran',
  ...over,
});

describe('createCheck', () => {
  it('posts a queued check named TrueCourse, carrying our id as its external id', async () => {
    const { octokit, calls } = fakeOctokit();
    const id = await createCheck(octokit, 'acme/api', { headSha: 'head-1', externalId: 'check_1' });
    expect(id).toBe(4242);
    expect(calls).toEqual([
      {
        method: 'create',
        params: { owner: 'acme', repo: 'api', name: CHECK_NAME, head_sha: 'head-1', external_id: 'check_1', status: 'queued' },
      },
    ]);
  });
});

describe('updateCheck', () => {
  it('completes with the reason’s conclusion and no annotations in one request', async () => {
    const { octokit, calls } = fakeOctokit();
    await updateCheck(octokit, 'acme/api', 4242, {
      status: 'completed',
      reason: 'no-base',
      detailsUrl: 'https://app/agent/run-1',
      output: { title: 't', summary: 's' },
    });
    expect(calls).toEqual([
      {
        method: 'update',
        params: {
          owner: 'acme',
          repo: 'api',
          check_run_id: 4242,
          status: 'completed',
          conclusion: 'neutral',
          details_url: 'https://app/agent/run-1',
          output: { title: 't', summary: 's' },
        },
      },
    ]);
  });

  it('sends annotations fifty at a time, each request carrying the same output', async () => {
    const { octokit, calls } = fakeOctokit();
    const annotations = Array.from({ length: 120 }, (_, i) => ({
      path: 'docs/a.md',
      startLine: i + 1,
      message: `conflict ${i}`,
    }));
    await updateCheck(octokit, 'acme/api', 4242, {
      status: 'completed',
      reason: 'conflict',
      conclusion: 'failure',
      output: { title: 't', summary: 's', annotations },
    });
    expect(calls.map((c) => (c.params.output as { annotations: unknown[] }).annotations.length)).toEqual([50, 50, 20]);
    expect(calls.every((c) => c.params.conclusion === 'failure')).toBe(true);
    expect((calls[0]!.params.output as { annotations: Record<string, unknown>[] }).annotations[0]).toEqual({
      path: 'docs/a.md',
      start_line: 1,
      end_line: 1,
      annotation_level: 'failure',
      message: 'conflict 0',
    });
  });
});

describe('renderCheckOutput', () => {
  it('leads with the counts, lists the four parts in order, and links the report', () => {
    const out = renderCheckOutput(
      'new-failures',
      report({
        conflictsCreated: [
          {
            docs: ['context/src/docs/a.md', 'context/src/docs/b.md'],
            sections: [['Login'], ['Sessions']],
            note: 'one hour vs two',
            path: 'docs/a.md',
            line: 12,
            blocksRepositories: ['acme/api'],
          },
        ],
        sectionsMoved: [{ doc: 'context/src/docs/a.md', anchor: 'login', flows: [{ id: 'f1', title: 'Login flow' }] }],
        repositoriesAffected: [{ repoFullName: 'acme/web', slug: 'web' }],
      }),
      'https://app/agent/run-1',
    );
    expect(out.title).toBe('New failures');
    const summary = out.summary;
    expect(summary.startsWith('**1 conflict created · 1 section moved · 1 other repository affected · 1 new failure · 2 pre-existing · 0 fixed**')).toBe(true);
    const order = ['## Conflicts created', '## Sections moved', '## Repositories affected', '## The run', '[The full report]'].map((h) => summary.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(summary).toContain('context/src/docs/a.md · Login vs context/src/docs/b.md · Sessions: one hour vs two');
    expect(summary).toContain('context/src/docs/a.md · login (Login flow)');
    expect(summary).toContain('- acme/web');
    expect(summary).toContain('### New failures\n\n- Checkout completes (bug)');
    expect(summary.endsWith('[The full report](https://app/agent/run-1)')).toBe(true);
    expect(out.annotations).toEqual([
      { path: 'docs/a.md', startLine: 12, message: 'Conflicts with context/src/docs/b.md: one hour vs two' },
    ]);
  });

  it('cuts back to the counts and the link when the whole would not fit', () => {
    const out = renderCheckOutput(
      'clean',
      report({
        run: {
          runId: 'r',
          counts: { newFailures: 0, preExisting: 3000, fixed: 0, newlyBlocked: 0, added: 0, retired: 0 },
          newFailures: [],
          preExisting: Array.from({ length: 3000 }, (_, i) => ({ id: `f${i}`, title: 'x'.repeat(40) })),
          fixed: [],
          newlyBlocked: [],
        },
      }),
      'https://app/agent/run-1',
    );
    expect(out.summary.length).toBeLessThan(60_000);
    expect(out.summary).toBe('**0 conflicts created · 0 sections moved · 0 other repositories affected · 0 new failures · 3000 pre-existing · 0 fixed**\n\n[The full report](https://app/agent/run-1)');
  });

  it('says what a settled check without a report means', () => {
    expect(renderCheckOutput('draft', null, null)).toEqual({
      title: 'Checked when ready for review',
      summary: 'Drafts are not checked. Mark the pull request ready for review and it will be.',
    });
    expect(renderCheckOutput('no-base', null, 'https://app/agent/r').summary).toContain('Rebase onto a newer');
  });

  it('says the code was not run when there is no run', () => {
    const out = renderCheckOutput('conflict', report({ run: null, codeHalf: 'stopped-by-conflict' }), null);
    expect(out.summary).toContain('code not run (stopped by conflict)');
  });
});
