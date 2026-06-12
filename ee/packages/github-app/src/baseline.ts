/**
 * Baseline capture: clone a repo's default branch and run a full verify,
 * saving the result as the per-repo baseline the PR gate diffs against.
 * Refreshed whenever the default branch advances (merge).
 *
 * Contracts come from the server-side store keyed by `(owner/repo, commit)`. On
 * a miss the default head's contracts are generated on the clone and persisted
 * under the commit, then verified. A repo with no spec docs yields a "neutral"
 * baseline (`drifts: null`). A generation/verify FAILURE is NOT saved as neutral
 * — it propagates (the caller logs it) so the prior baseline is left intact and
 * the gate self-heals, rather than silently going non-blocking.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { verifyInProcess } from '@truecourse/core/commands/spec-in-process';
import type { StepTracker } from '@truecourse/core/progress';
import { hasContracts, listWorkspaceContractFiles, type RepoRef } from '@truecourse/core/lib/contract-store';
import { log } from '@truecourse/core/lib/logger';
import type { GateStore, GateDrift } from './store/types.js';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';
import { defaultSpecScanPipeline, type SpecScanPipeline } from './spec-scan.js';

export interface BaselineDeps {
  store: GateStore;
  auth: GithubAuth;
  /** Scan+generate pipeline for the cold path (injected in tests). */
  scanPipeline?: SpecScanPipeline;
  /** Phase callback for the stepped progress popup (EE jobs). */
  onPhase?: (phase: 'clone' | 'spec' | 'contracts' | 'drift') => void | Promise<void>;
  /** Per-slice contract-gen progress (`done`, `total`) for the popup's "N/M slices". */
  onSliceProgress?: (done: number, total: number) => void;
  /** Repair-pass progress (`done`, `total`) for the popup's "repairing N/M". */
  onRepairProgress?: (done: number, total: number) => void;
  /** Spec-scan tracker — driven through SCAN_STEPS for the popup's "Extracting spec" detail. */
  specTracker?: StepTracker;
}

export interface BaselineRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  /**
   * Re-run even if a baseline for this commit already exists. Used when contracts
   * were (re)generated for an unchanged head (post-conflict-resolve), so a neutral
   * baseline must be upgraded to a real verify. Webhook/connect runs leave it off
   * so a redelivered push doesn't re-clone.
   */
  force?: boolean;
}

/** What the baseline run produced — lets the caller word an accurate notification. */
export interface BaselineResult {
  /** Open spec conflicts found this scan; `>0` ⇒ contracts were NOT generated. */
  openConflicts: number;
  /** Whether the saved baseline has contracts to check against (own repo or inherited workspace). */
  hasContracts: boolean;
}

export async function runBaseline(
  deps: BaselineDeps,
  req: BaselineRequest,
): Promise<BaselineResult> {
  // GitHub webhook delivery is at-least-once; skip if this commit is already
  // the saved baseline so a redelivered push doesn't re-clone + re-verify. A
  // `force` run (post-resolve re-baseline) bypasses this — the commit is the same
  // but contracts now exist where the prior run skipped them, so verify must rerun.
  const existing = await deps.store.getBaseline(req.repoFullName);
  if (!req.force && existing?.commitSha === req.commitSha) {
    log.info(
      `[github-app] baseline for ${req.repoFullName}@${req.commitSha.slice(0, 7)} already current — skipping`,
    );
    // A null baseline means "no contracts" (neutral); an array means contracts existed.
    return { openConflicts: 0, hasContracts: existing.drifts !== null };
  }

  const scanPipeline = deps.scanPipeline ?? defaultSpecScanPipeline;
  const ref: RepoRef = { repoKey: req.repoFullName, commitSha: req.commitSha };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-baseline-'));
  try {
    await deps.onPhase?.('clone');
    const token = await getInstallationToken(deps.auth, req.installationId);
    await simpleGit().clone(cloneUrl(req.repoFullName), tmp, [
      ...cloneAuthArgs(token),
      '--depth',
      '1',
      '--branch',
      req.defaultBranch,
    ]);
    await stripEmbeddedAuth(simpleGit(tmp));

    // Generate the default head's contracts into the store if not present.
    // A failure here (or in verify) must NOT be saved as a neutral baseline:
    // a `null` baseline reads identically to "no spec" and would make the gate
    // go `no-baseline` (non-blocking) for every PR against this commit. So we
    // let the throw propagate (the caller logs it) and leave the prior baseline
    // untouched — the gate self-heals by recomputing the base live. A `null`
    // baseline is established ONLY when generation legitimately produced no
    // contracts.
    let openConflicts = 0;
    if (!(await hasContracts(ref, 'contracts'))) {
      await deps.onPhase?.('spec');
      ({ openConflicts } = await scanPipeline.scan(tmp, ref, deps.specTracker));
      // Contracts are only generated from a fully-resolved spec. An open conflict
      // makes the canonical set ambiguous, so we persist the spec (scan did) but
      // skip generation — the baseline stays neutral until the conflicts are
      // resolved in the dashboard, which regenerates contracts (repo.contracts).
      if (openConflicts === 0) {
        await deps.onPhase?.('contracts');
        await scanPipeline.generate(tmp, ref, deps.onSliceProgress, deps.onRepairProgress);
      } else {
        log.info(
          `[github-app] ${req.repoFullName}@${req.commitSha.slice(0, 7)} has ${openConflicts} open conflict(s) — skipping contract generation (neutral baseline until resolved)`,
        );
      }
    }
    // The baseline must use the SAME effective contracts (workspace ∪ repo) as
    // the PR-head verify, or base-vs-head diffs are computed against different
    // corpora. Verify when the repo has its own contracts OR inherits workspace
    // contracts; a genuinely spec-less repo stays a neutral (null) baseline.
    const link = await deps.store.getRepo(req.repoFullName);
    const workspaceOrgId = link?.workspaceOrgId ?? null;
    const repoHas = await hasContracts(ref, 'contracts');
    const wsHas = workspaceOrgId
      ? (await listWorkspaceContractFiles({ workspaceOrgId }, 'contracts')).length > 0
      : false;
    let drifts: GateDrift[] | null = null;
    if (repoHas || wsHas) {
      await deps.onPhase?.('drift');
      const { verify } = await verifyInProcess(tmp, { skipStash: true, ref, workspaceOrgId });
      drifts = verify.drifts;
    }

    await deps.store.saveBaseline({
      repoFullName: req.repoFullName,
      commitSha: req.commitSha,
      drifts,
      capturedAt: new Date().toISOString(),
    });
    log.info(
      `[github-app] baseline saved for ${req.repoFullName}@${req.commitSha.slice(0, 7)} (${
        drifts ? `${drifts.length} drifts` : 'neutral'
      })`,
    );
    return { openConflicts, hasContracts: repoHas || wsHas };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
