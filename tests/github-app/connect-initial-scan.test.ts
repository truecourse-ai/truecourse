/**
 * What the gate hangs off the connection router's post-link seam: register the
 * project, then enqueue the repo's INITIAL scan at the default branch's head.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { registerProject } = vi.hoisted(() => ({ registerProject: vi.fn() }));
// The registry writes to the file-based OSS registry; stub it so the hook is
// exercised without touching disk.
vi.mock('@truecourse/core/config/registry', () => ({
  registerProject,
  getProjectByPath: vi.fn().mockResolvedValue(null),
}));

import { createRepoLinkedHook } from '../../ee/packages/github-app/src/connect-gate';
import type { OctokitClient, RepoLinkRecord } from '../../packages/scm-github/src/index';

const LINK: RepoLinkRecord = {
  repoFullName: 'mushgev/truecourse-gate-test',
  installationId: 42,
  workspaceOrgId: 'org_A',
  defaultBranch: 'main',
  blocking: true,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let getBranch: ReturnType<typeof vi.fn>;
let octokit: OctokitClient;

beforeEach(() => {
  registerProject.mockReset().mockResolvedValue(undefined);
  getBranch = vi.fn().mockResolvedValue({ data: { commit: { sha: 'abc1234567' } } });
  octokit = { repos: { getBranch } } as unknown as OctokitClient;
});

describe('the gate’s post-link hook', () => {
  it('registers the project and enqueues a baseline scan at the branch head', async () => {
    const enqueueBaseline = vi.fn().mockResolvedValue('job_1');

    await createRepoLinkedHook(enqueueBaseline)(LINK, octokit);

    expect(registerProject).toHaveBeenCalledWith(LINK.repoFullName, LINK.repoFullName);
    expect(getBranch).toHaveBeenCalledWith({
      owner: 'mushgev',
      repo: 'truecourse-gate-test',
      branch: 'main',
    });
    expect(enqueueBaseline).toHaveBeenCalledWith({
      repoFullName: LINK.repoFullName,
      installationId: 42,
      defaultBranch: 'main',
      commitSha: 'abc1234567',
      workspaceOrgId: 'org_A',
    });
  });

  it('registers the project but resolves no branch head when no queue is wired', async () => {
    await createRepoLinkedHook()(LINK, octokit);

    expect(registerProject).toHaveBeenCalledOnce();
    expect(getBranch).not.toHaveBeenCalled();
  });

  it('surfaces an enqueue failure to the caller (the router keeps the link)', async () => {
    const enqueueBaseline = vi.fn().mockRejectedValue(new Error('queue down'));

    await expect(createRepoLinkedHook(enqueueBaseline)(LINK, octokit)).rejects.toThrow(
      'queue down',
    );
  });
});
