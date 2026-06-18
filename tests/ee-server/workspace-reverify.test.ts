import { describe, it, expect, vi } from 'vitest';
import type { GateStore, RepoLinkRecord, BaselineRecord } from '../../ee/packages/github-app/src/store/types';
import { reverifyWorkspaceRepos } from '../../ee/packages/server/src/jobs/reverify';

const ORG = 'org_A';

function repo(name: string): RepoLinkRecord {
  return {
    repoFullName: name,
    installationId: 1,
    workspaceOrgId: ORG,
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function baseline(name: string, commitSha: string): BaselineRecord {
  return { repoFullName: name, commitSha, drifts: [], capturedAt: '2026-01-01T00:00:00.000Z' };
}

/** Gate store stub: only the two methods the fan-out touches. */
function fakeStore(repos: RepoLinkRecord[], baselines: Record<string, BaselineRecord>): GateStore {
  return {
    listReposForWorkspace: async () => repos,
    getBaseline: async (name: string) => baselines[name] ?? null,
  } as unknown as GateStore;
}

describe('reverifyWorkspaceRepos — workspace→repos ripple', () => {
  it('enqueues a FORCED + QUIET re-verify per repo, keyed by its baseline commit', async () => {
    const store = fakeStore(
      [repo('o/a'), repo('o/b')],
      { 'o/a': baseline('o/a', 'sha-a'), 'o/b': baseline('o/b', 'sha-b') },
    );
    const enqueue = vi.fn().mockResolvedValue('job-id');

    const count = await reverifyWorkspaceRepos(store, enqueue, ORG);

    expect(count).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        repoFullName: 'o/a',
        commitSha: 'sha-a',
        workspaceOrgId: ORG,
        force: true,
        quiet: true,
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ repoFullName: 'o/b', commitSha: 'sha-b' }));
  });

  it('skips a repo that has never been scanned (no baseline → no head commit)', async () => {
    const store = fakeStore([repo('o/a'), repo('o/unscanned')], { 'o/a': baseline('o/a', 'sha-a') });
    const enqueue = vi.fn().mockResolvedValue('job-id');

    const count = await reverifyWorkspaceRepos(store, enqueue, ORG);

    expect(count).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ repoFullName: 'o/a' }));
  });

  it('counts only repos actually enqueued (single-flight skip ⇒ enqueue returns null)', async () => {
    const store = fakeStore(
      [repo('o/a'), repo('o/b')],
      { 'o/a': baseline('o/a', 'sha-a'), 'o/b': baseline('o/b', 'sha-b') },
    );
    // o/a is already mid-baseline → null; o/b enqueues.
    const enqueue = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('job-id');

    const count = await reverifyWorkspaceRepos(store, enqueue, ORG);

    expect(count).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a workspace with no connected repos', async () => {
    const enqueue = vi.fn().mockResolvedValue('job-id');
    const count = await reverifyWorkspaceRepos(fakeStore([], {}), enqueue, ORG);
    expect(count).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
