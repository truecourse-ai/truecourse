/**
 * createGuardPrRegenEnqueue — the `(repoKey, pr) → hosted PR-head regen` resolver
 * the EE server installs into the core `setGuardPrRegenEnqueue` seam. It resolves
 * installation / workspace org from the stored gate records and the LIVE pull
 * request (base/head/fork) from GitHub — the same resolution the spec-change
 * checkbox handler uses — then enqueues the durable `guard.spec-regen` job with
 * NO checkbox comment to settle (commentId null). Best-effort: an unconnected
 * repo resolves to a silent no-op rather than throwing into the decision save.
 */
import { describe, it, expect, vi } from 'vitest';
import { createGuardPrRegenEnqueue } from '../../ee/packages/server/src/guard/index';

const ORG = 'org_A';
const REPO = 'acme/api';
const PR = 25;

const repoLink = {
  repoFullName: REPO,
  installationId: 42,
  workspaceOrgId: ORG,
  defaultBranch: 'main',
  enabled: true,
};

const livePr = {
  head: { ref: 'feat/x', sha: 'headsha42', repo: { full_name: REPO } },
  base: { ref: 'main', sha: 'basesha11' },
};

function build(overrides: {
  getRepo?: ReturnType<typeof vi.fn>;
  pullsGet?: ReturnType<typeof vi.fn>;
  enqueueGuardSpecRegen?: ReturnType<typeof vi.fn>;
}) {
  const enqueueGuardSpecRegen =
    overrides.enqueueGuardSpecRegen ?? vi.fn().mockResolvedValue('job_r1');
  const pullsGet = overrides.pullsGet ?? vi.fn().mockResolvedValue({ data: livePr });
  const octokit = { pulls: { get: pullsGet } };
  const enqueue = createGuardPrRegenEnqueue({
    store: { getRepo: overrides.getRepo ?? vi.fn().mockResolvedValue(repoLink) },
    octokitFor: () => octokit as never,
    enqueueGuardSpecRegen,
  });
  return { enqueue, enqueueGuardSpecRegen, pullsGet };
}

describe('createGuardPrRegenEnqueue', () => {
  it('resolves the gate link + live PR and enqueues the spec-regen with no comment to settle', async () => {
    const { enqueue, enqueueGuardSpecRegen, pullsGet } = build({});
    await enqueue(REPO, PR);
    expect(pullsGet).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', pull_number: PR });
    expect(enqueueGuardSpecRegen).toHaveBeenCalledWith({
      repoFullName: REPO,
      installationId: 42,
      workspaceOrgId: ORG,
      prNumber: PR,
      defaultBranch: 'main',
      baseBranch: 'main',
      baseSha: 'basesha11',
      headRef: 'feat/x',
      headSha: 'headsha42',
      isFork: false,
      commentId: null,
    });
  });

  it('marks a fork PR (head repo differs from the base repo)', async () => {
    const { enqueue, enqueueGuardSpecRegen } = build({
      pullsGet: vi.fn().mockResolvedValue({
        data: { ...livePr, head: { ...livePr.head, repo: { full_name: 'forker/api' } } },
      }),
    });
    await enqueue(REPO, PR);
    expect(enqueueGuardSpecRegen).toHaveBeenCalledWith(expect.objectContaining({ isFork: true }));
  });

  it('falls back to the default branch when the live PR has no base ref', async () => {
    const { enqueue, enqueueGuardSpecRegen } = build({
      pullsGet: vi.fn().mockResolvedValue({ data: { ...livePr, base: undefined } }),
    });
    await enqueue(REPO, PR);
    expect(enqueueGuardSpecRegen).toHaveBeenCalledWith(
      expect.objectContaining({ baseBranch: 'main' }),
    );
  });

  it('no-ops for a repo that is not connected (no GitHub call, no enqueue)', async () => {
    const { enqueue, enqueueGuardSpecRegen, pullsGet } = build({
      getRepo: vi.fn().mockResolvedValue(null),
    });
    await enqueue(REPO, PR);
    expect(pullsGet).not.toHaveBeenCalled();
    expect(enqueueGuardSpecRegen).not.toHaveBeenCalled();
  });

  it('no-ops for a repo with no workspace (no enqueue)', async () => {
    const { enqueue, enqueueGuardSpecRegen } = build({
      getRepo: vi.fn().mockResolvedValue({ ...repoLink, workspaceOrgId: null }),
    });
    await enqueue(REPO, PR);
    expect(enqueueGuardSpecRegen).not.toHaveBeenCalled();
  });

  it('no-ops for a repo whose gate is disabled — the job would re-gate it (same rule as the checkbox)', async () => {
    const { enqueue, enqueueGuardSpecRegen, pullsGet } = build({
      getRepo: vi.fn().mockResolvedValue({ ...repoLink, enabled: false }),
    });
    await enqueue(REPO, PR);
    expect(pullsGet).not.toHaveBeenCalled();
    expect(enqueueGuardSpecRegen).not.toHaveBeenCalled();
  });

  it('tolerates a single-flight null (a regen already running for that head)', async () => {
    const { enqueue, enqueueGuardSpecRegen } = build({
      enqueueGuardSpecRegen: vi.fn().mockResolvedValue(null),
    });
    await expect(enqueue(REPO, PR)).resolves.toBeUndefined();
    expect(enqueueGuardSpecRegen).toHaveBeenCalledTimes(1);
  });
});
