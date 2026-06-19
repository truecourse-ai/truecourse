import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileGateStore,
  type InstallationRecord,
  type RepoLinkRecord,
  type GateRunRecord,
} from '../../ee/packages/github-app/src/index';

let dir: string;
let store: FileGateStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-store-'));
  store = new FileGateStore(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function installation(id: number, org: string | null = null): InstallationRecord {
  return {
    installationId: id,
    accountLogin: `acct-${id}`,
    accountType: 'Organization',
    workspaceOrgId: org,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function repo(name: string, installationId: number, org: string): RepoLinkRecord {
  return {
    repoFullName: name,
    installationId,
    workspaceOrgId: org,
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('FileGateStore', () => {
  it('round-trips installations and links them to a workspace', async () => {
    await store.saveInstallation(installation(1));
    expect((await store.getInstallation(1))?.accountLogin).toBe('acct-1');
    expect(await store.getInstallation(999)).toBeNull();

    await store.linkInstallationToWorkspace(1, 'org_A');
    expect((await store.getInstallation(1))?.workspaceOrgId).toBe('org_A');

    await store.saveInstallation(installation(2, 'org_B'));
    const forA = await store.listInstallationsForWorkspace('org_A');
    expect(forA.map((i) => i.installationId)).toEqual([1]);
  });

  it('round-trips repo links and scopes by workspace', async () => {
    await store.linkRepo(repo('acme/api', 1, 'org_A'));
    await store.linkRepo(repo('acme/web', 1, 'org_A'));
    await store.linkRepo(repo('other/svc', 2, 'org_B'));

    expect((await store.getRepo('acme/api'))?.defaultBranch).toBe('main');
    const forA = await store.listReposForWorkspace('org_A');
    expect(forA.map((r) => r.repoFullName).sort()).toEqual([
      'acme/api',
      'acme/web',
    ]);

    await store.unlinkRepo('acme/api');
    expect(await store.getRepo('acme/api')).toBeNull();
  });

  it('cascades repo removal when an installation is deleted', async () => {
    await store.saveInstallation(installation(1, 'org_A'));
    await store.linkRepo(repo('acme/api', 1, 'org_A'));
    await store.linkRepo(repo('acme/web', 1, 'org_A'));
    await store.saveBaseline({
      repoFullName: 'acme/api',
      commitSha: 'abc',
      drifts: [],
      capturedAt: '2026-01-02T00:00:00.000Z',
    });
    await store.recordRun({
      id: 'r1',
      repoFullName: 'acme/api',
      prNumber: 1,
      headSha: 'sha',
      baseSha: 'base',
      conclusion: 'success',
      addedCount: 0,
      resolvedCount: 0,
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    await store.removeInstallation(1);
    expect(await store.getInstallation(1)).toBeNull();
    expect(await store.getRepo('acme/api')).toBeNull();
    expect(await store.getRepo('acme/web')).toBeNull();
    // Cascade also clears baselines + run history for the removed repos.
    expect(await store.getBaseline('acme/api')).toBeNull();
    expect(await store.listRuns('acme/api')).toEqual([]);
  });

  it('saveInstallation preserves an existing workspace link and createdAt', async () => {
    await store.saveInstallation(installation(1));
    await store.linkInstallationToWorkspace(1, 'org_A');
    // A re-sent install event with no workspace must not wipe the link.
    await store.saveInstallation({
      installationId: 1,
      accountLogin: 'acct-1-renamed',
      accountType: 'Organization',
      workspaceOrgId: null,
      createdAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z',
    });
    const rec = await store.getInstallation(1);
    expect(rec?.workspaceOrgId).toBe('org_A');
    expect(rec?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(rec?.accountLogin).toBe('acct-1-renamed');
  });

  it('round-trips baselines including a neutral (null-drift) baseline', async () => {
    await store.saveBaseline({
      repoFullName: 'acme/api',
      commitSha: 'abc123',
      drifts: [],
      capturedAt: '2026-01-02T00:00:00.000Z',
    });
    expect((await store.getBaseline('acme/api'))?.commitSha).toBe('abc123');

    await store.saveBaseline({
      repoFullName: 'acme/web',
      commitSha: 'def456',
      drifts: null,
      capturedAt: '2026-01-02T00:00:00.000Z',
    });
    expect((await store.getBaseline('acme/web'))?.drifts).toBeNull();
    expect(await store.getBaseline('nope/none')).toBeNull();
  });

  it('records runs most-recent-first and honors the limit', async () => {
    const mk = (id: string, n: number): GateRunRecord => ({
      id,
      repoFullName: 'acme/api',
      prNumber: n,
      headSha: `sha${n}`,
      baseSha: 'base',
      conclusion: 'success',
      addedCount: 0,
      resolvedCount: 0,
      createdAt: `2026-01-0${n}T00:00:00.000Z`,
    });
    await store.recordRun(mk('r1', 1));
    await store.recordRun(mk('r2', 2));
    await store.recordRun(mk('r3', 3));

    const all = await store.listRuns('acme/api');
    expect(all.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
    expect(await store.listRuns('acme/api', 1)).toHaveLength(1);
    expect(await store.listRuns('other/repo')).toEqual([]);
  });
});
