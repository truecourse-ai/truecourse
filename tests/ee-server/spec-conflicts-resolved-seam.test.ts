/**
 * createSpecConflictsResolvedBaselineScan — the `repoKey → hosted baseline scan`
 * resolver the EE server installs into the core `setSpecConflictsResolvedHook`
 * seam. A repo-scope spec decision that clears the last open conflict fires it so
 * the hosted repo re-scans its baseline (force — the commit hasn't moved) and the
 * conflict-free scan chains scenario generation. Resolution mirrors the guard
 * Generate seam (installation / default branch / baseline commit / workspace org
 * from the stored gate records); best-effort — an unconnected repo or a repo with
 * no baseline resolves to a silent no-op rather than throwing into the decision save.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSpecConflictsResolvedBaselineScan } from '../../ee/packages/server/src/guard/index';

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
  enqueueBaseline?: ReturnType<typeof vi.fn>;
}) {
  const enqueueBaseline = overrides.enqueueBaseline ?? vi.fn().mockResolvedValue('job_b1');
  const enqueue = createSpecConflictsResolvedBaselineScan({
    store: {
      getRepo: overrides.getRepo ?? vi.fn().mockResolvedValue(repoLink),
      getBaseline:
        overrides.getBaseline ??
        vi.fn().mockResolvedValue({ repoFullName: REPO, commitSha: 'abc1234567' }),
    },
    enqueueBaseline,
  });
  return { enqueue, enqueueBaseline };
}

describe('createSpecConflictsResolvedBaselineScan', () => {
  it('resolves installation/branch/baseline/org and enqueues a FORCE baseline scan', async () => {
    const { enqueue, enqueueBaseline } = build({});
    await enqueue(REPO);
    expect(enqueueBaseline).toHaveBeenCalledWith({
      repoFullName: REPO,
      installationId: 42,
      defaultBranch: 'main',
      commitSha: 'abc1234567',
      workspaceOrgId: ORG,
      // The commit hasn't moved (a decision, not a push) — force the re-curate.
      force: true,
    });
  });

  it('no-ops for a repo that is not connected (no enqueue)', async () => {
    const { enqueue, enqueueBaseline } = build({ getRepo: vi.fn().mockResolvedValue(null) });
    await enqueue(REPO);
    expect(enqueueBaseline).not.toHaveBeenCalled();
  });

  it('no-ops for a repo with no workspace (no enqueue)', async () => {
    const { enqueue, enqueueBaseline } = build({
      getRepo: vi.fn().mockResolvedValue({ ...repoLink, workspaceOrgId: null }),
    });
    await enqueue(REPO);
    expect(enqueueBaseline).not.toHaveBeenCalled();
  });

  it('no-ops when the repo has no baseline yet (no commit to key by)', async () => {
    const { enqueue, enqueueBaseline } = build({ getBaseline: vi.fn().mockResolvedValue(null) });
    await enqueue(REPO);
    expect(enqueueBaseline).not.toHaveBeenCalled();
  });

  it('tolerates a single-flight null (a baseline scan already running)', async () => {
    const { enqueue, enqueueBaseline } = build({
      enqueueBaseline: vi.fn().mockResolvedValue(null),
    });
    await expect(enqueue(REPO)).resolves.toBeUndefined();
    expect(enqueueBaseline).toHaveBeenCalledTimes(1);
  });
});
