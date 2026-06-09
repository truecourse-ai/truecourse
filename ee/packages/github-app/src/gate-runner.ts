/**
 * Gate verify runner: clone the PR's base branch, get the base drifts (from the
 * saved baseline when the base IS the default branch, else verify the base),
 * then fetch + check out the PR head via `refs/pull/<n>/head` (which lives in
 * the base repo, so this works for fork PRs too) and verify it. Read-only — the
 * gate never pushes.
 *
 * Contracts come from the SERVER-SIDE store keyed by `(owner/repo, commit)`, not
 * from the customer's repo (commit-back was removed). For each commit the gate
 * needs drifts for, `driftsForCommit` sources contracts warm-from-store; on a
 * miss it regenerates them ON THE CURRENT CHECKOUT (no second clone) and
 * persists under the commit, then verifies. A genuine absence of spec docs ⇒
 * `null` (neutral `no-contracts`); a *generation failure* throws and surfaces as
 * the gate's error Check — it must never collapse to neutral.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { verifyInProcess } from '@truecourse/core/commands/spec-in-process';
import { hasContracts, listWorkspaceContractFiles, type RepoRef } from '@truecourse/core/lib/contract-store';
import { loadSpec } from '@truecourse/core/lib/spec-store';
import type { GateStore, GateDrift } from './store/types.js';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';
import { defaultSpecScanPipeline, type SpecScanPipeline } from './spec-scan.js';

/**
 * Verify a checkout against the contracts stored under `ref`; returns its
 * drifts, or null when verification can't run (no contracts). Code = `dir`.
 * `workspaceOrgId` (enterprise) folds the workspace contracts under the repo's
 * for an EFFECTIVE verify (repo wins on collision); omit for repo-only.
 */
export type VerifyFn = (
  dir: string,
  ref: RepoRef,
  workspaceOrgId?: string | null,
) => Promise<GateDrift[] | null>;

const defaultVerify: VerifyFn = async (dir, ref, workspaceOrgId) => {
  try {
    const { verify } = await verifyInProcess(dir, { skipStash: true, ref, workspaceOrgId });
    return verify.drifts;
  } catch (e) {
    // ONLY the genuine "no contracts for this commit" case is neutral. Every
    // other failure (a missing/GC'd object, a verifier crash, a transient blob
    // read error) is a real failure that must propagate to the gate's error
    // Check — never silently collapse to neutral and stop blocking real drift.
    if (e instanceof Error && /Contracts directory not found/.test(e.message)) return null;
    throw e;
  }
};

function toPosixRel(root: string, p: string): string {
  return path.isAbsolute(p) ? path.relative(root, p).split(path.sep).join('/') : p;
}

/** Rewrite absolute temp-clone paths in a drift to repo-relative form. */
function relativizeDrifts(drifts: GateDrift[], root: string): GateDrift[] {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return drifts.map((d) => ({
    ...d,
    filePath: toPosixRel(root, d.filePath),
    codeSide: d.codeSide ? d.codeSide.split(prefix).join('') : d.codeSide,
  }));
}

export interface GateVerifyDeps {
  store: GateStore;
  auth: GithubAuth;
  verify?: VerifyFn;
  /** Scan+generate pipeline for the cold path (injected in tests). */
  scanPipeline?: SpecScanPipeline;
}

export interface GateVerifyRequest {
  repoFullName: string;
  installationId: number;
  prNumber: number;
  /** The PR's actual base ref. */
  baseBranch: string;
  /** The repo default branch (saved baseline is only valid for this). */
  defaultBranch: string;
  /** The repo's linked workspace org (enterprise) — drives the effective merge. */
  workspaceOrgId?: string | null;
}

export interface GateVerifyOutput {
  /** PR head drifts (repo-relative paths), or null when the head has no contracts. */
  headDrifts: GateDrift[] | null;
  /** Base drifts, or null when the base has no contracts (can't diff). */
  baseDrifts: GateDrift[] | null;
  baseSha: string | null;
  /** The sha we actually verified (resolved from the pull ref). */
  headSha: string | null;
  /**
   * Unresolved spec conflicts found while cold-generating the HEAD's contracts
   * (0 when the head's contracts were already stored, so no scan ran). >0 means
   * the gate verified against an auto-defaulted spec and should stay neutral.
   */
  headConflicts: number;
}

/** A commit's drifts plus the open-conflict count from any cold-gen scan. */
export interface CommitDrifts {
  /** Drifts (repo-relative paths), or null when the commit has no contracts. */
  drifts: GateDrift[] | null;
  /** Open conflicts the cold-gen scan auto-defaulted (0 on the warm path). */
  openConflicts: number;
}

/**
 * Drifts for `(repoFullName, sha)`, sourcing contracts from the server-side
 * store with code from `checkoutDir`. Cold (no contracts yet): scan+generate on
 * the checkout, persist under the commit, verify. Warm (contracts already
 * stored): verify directly. Either way the open-conflict count is the
 * AUTHORITATIVE one for this commit — fresh from the scan on the cold path, read
 * back from the persisted scan-state on the warm path — so the gate refuses to
 * trust an auto-defaulted spec regardless of whether it generated it this run.
 * No spec at all → drifts null (neutral `no-contracts`). A generation throw
 * PROPAGATES (so the gate posts an error Check) — never collapse to neutral.
 */
export async function driftsForCommit(
  scanPipeline: SpecScanPipeline,
  verify: VerifyFn,
  repoFullName: string,
  sha: string,
  checkoutDir: string,
  workspaceOrgId?: string | null,
): Promise<CommitDrifts> {
  const ref: RepoRef = { repoKey: repoFullName, commitSha: sha };
  let openConflicts: number;
  if (!(await hasContracts(ref, 'contracts'))) {
    ({ openConflicts } = await scanPipeline.scan(checkoutDir, ref));
    await scanPipeline.generate(checkoutDir, ref);
  } else {
    // Already generated (e.g. an earlier gate run or the scan checkbox). The
    // scan persisted its conflict count under the ref; recover it so a warm
    // cache can't silently downgrade a conflicted spec to "trusted".
    const ss = await loadSpec<{ openConflicts?: unknown[] }>(ref, 'scanState');
    openConflicts = ss?.openConflicts?.length ?? 0;
  }
  // Neutral ONLY when the repo has neither its own contracts nor any workspace
  // contracts to inherit — otherwise the repo is verified against its EFFECTIVE
  // contracts (workspace ∪ repo). A repo with no contracts of its own still
  // drifts against the shared workspace contracts: the cross-repo ripple.
  const repoHas = await hasContracts(ref, 'contracts');
  const wsHas = workspaceOrgId
    ? (await listWorkspaceContractFiles({ workspaceOrgId }, 'contracts')).length > 0
    : false;
  if (!repoHas && !wsHas) return { drifts: null, openConflicts }; // genuinely no spec
  const d = await verify(checkoutDir, ref, workspaceOrgId);
  return { drifts: d ? relativizeDrifts(d, checkoutDir) : null, openConflicts };
}

export async function runGateVerify(
  deps: GateVerifyDeps,
  req: GateVerifyRequest,
): Promise<GateVerifyOutput> {
  const verify = deps.verify ?? defaultVerify;
  const scanPipeline = deps.scanPipeline ?? defaultSpecScanPipeline;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-verify-'));

  const driftsAt = (sha: string): Promise<CommitDrifts> =>
    driftsForCommit(scanPipeline, verify, req.repoFullName, sha, tmp, req.workspaceOrgId);

  try {
    const token = await getInstallationToken(deps.auth, req.installationId);
    const auth = cloneAuthArgs(token);

    await simpleGit().clone(cloneUrl(req.repoFullName), tmp, [
      ...auth,
      '--depth',
      '1',
      '--branch',
      req.baseBranch,
    ]);
    const git = simpleGit(tmp);
    await stripEmbeddedAuth(git);
    const baseSha = (await git.revparse(['HEAD'])).trim();

    // Base drifts: the saved baseline only models the DEFAULT branch, so it's
    // valid only when the PR targets it; otherwise regenerate/verify the base.
    // (Base-side conflicts don't gate — only the head's spec is the PR's doing.)
    let baseDrifts: GateDrift[] | null;
    if (req.baseBranch === req.defaultBranch) {
      const baseline = await deps.store.getBaseline(req.repoFullName);
      baseDrifts = baseline ? baseline.drifts : (await driftsAt(baseSha)).drifts;
    } else {
      baseDrifts = (await driftsAt(baseSha)).drifts;
    }

    // Fetch + check out the PR head (the pull ref lives in the base repo).
    await git.raw([
      ...auth,
      'fetch',
      '--depth',
      '1',
      'origin',
      `refs/pull/${req.prNumber}/head`,
    ]);
    await git.raw(['checkout', '-f', 'FETCH_HEAD']);
    const headSha = (await git.revparse(['HEAD'])).trim();

    const head = await driftsAt(headSha);
    return {
      headDrifts: head.drifts,
      baseDrifts,
      baseSha,
      headSha,
      headConflicts: head.openConflicts,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
