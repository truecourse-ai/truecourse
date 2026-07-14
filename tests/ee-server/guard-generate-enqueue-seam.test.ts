/**
 * createGuardGenerateEnqueue — the `repoKey → hosted guard generate` resolver the
 * EE server installs into the core `setGuardGenerateEnqueue` seam. It resolves
 * installation / default branch / baseline commit / workspace org from the stored
 * gate records (the SAME resolution the manual Generate router does, minus the
 * request org) and enqueues. Best-effort: an unconnected repo or a repo with no
 * baseline resolves to a silent no-op rather than throwing into the decision save.
 */
import { describe, it, expect, vi } from 'vitest';
import { createGuardGenerateEnqueue } from '../../ee/packages/server/src/guard/index';

const ORG = 'org_A';
const REPO = 'acme/api';

const repoLink = {
  repoFullName: REPO,
  installationId: 42,
  workspaceOrgId: ORG,
  defaultBranch: 'main',
};

function build(overrides: {
  getRepo?: ReturnType<typeof vi.fn>;
  getBaseline?: ReturnType<typeof vi.fn>;
  enqueueGuardGenerate?: ReturnType<typeof vi.fn>;
}) {
  const enqueueGuardGenerate =
    overrides.enqueueGuardGenerate ?? vi.fn().mockResolvedValue('job_g1');
  const enqueue = createGuardGenerateEnqueue({
    store: {
      getRepo: overrides.getRepo ?? vi.fn().mockResolvedValue(repoLink),
      getBaseline:
        overrides.getBaseline ??
        vi.fn().mockResolvedValue({ repoFullName: REPO, commitSha: 'abc1234567' }),
    },
    enqueueGuardGenerate,
  });
  return { enqueue, enqueueGuardGenerate };
}

describe('createGuardGenerateEnqueue', () => {
  it('resolves installation/branch/baseline/org from the gate records and enqueues', async () => {
    const { enqueue, enqueueGuardGenerate } = build({});
    await enqueue(REPO);
    expect(enqueueGuardGenerate).toHaveBeenCalledWith({
      repoFullName: REPO,
      installationId: 42,
      defaultBranch: 'main',
      commitSha: 'abc1234567',
      workspaceOrgId: ORG,
    });
  });

  it('no-ops for a repo that is not connected (no enqueue)', async () => {
    const { enqueue, enqueueGuardGenerate } = build({
      getRepo: vi.fn().mockResolvedValue(null),
    });
    await enqueue(REPO);
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it('no-ops for a repo with no workspace (no enqueue)', async () => {
    const { enqueue, enqueueGuardGenerate } = build({
      getRepo: vi.fn().mockResolvedValue({ ...repoLink, workspaceOrgId: null }),
    });
    await enqueue(REPO);
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it('no-ops when the repo has no baseline yet (no commit to key by)', async () => {
    const { enqueue, enqueueGuardGenerate } = build({
      getBaseline: vi.fn().mockResolvedValue(null),
    });
    await enqueue(REPO);
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it('tolerates a single-flight null (a generate already running)', async () => {
    const { enqueue, enqueueGuardGenerate } = build({
      enqueueGuardGenerate: vi.fn().mockResolvedValue(null),
    });
    await expect(enqueue(REPO)).resolves.toBeUndefined();
    expect(enqueueGuardGenerate).toHaveBeenCalledTimes(1);
  });
});
