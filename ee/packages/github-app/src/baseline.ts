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
import { hasContracts, type RepoRef } from '@truecourse/core/lib/contract-store';
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
}

export interface BaselineRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
}

export async function runBaseline(
  deps: BaselineDeps,
  req: BaselineRequest,
): Promise<void> {
  // GitHub webhook delivery is at-least-once; skip if this commit is already
  // the saved baseline so a redelivered push doesn't re-clone + re-verify.
  const existing = await deps.store.getBaseline(req.repoFullName);
  if (existing?.commitSha === req.commitSha) {
    log.info(
      `[github-app] baseline for ${req.repoFullName}@${req.commitSha.slice(0, 7)} already current — skipping`,
    );
    return;
  }

  const scanPipeline = deps.scanPipeline ?? defaultSpecScanPipeline;
  const ref: RepoRef = { repoKey: req.repoFullName, commitSha: req.commitSha };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-baseline-'));
  try {
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
    if (!(await hasContracts(ref, 'contracts'))) {
      await scanPipeline.scan(tmp, ref);
      await scanPipeline.generate(tmp, ref);
    }
    let drifts: GateDrift[] | null = null;
    if (await hasContracts(ref, 'contracts')) {
      const { verify } = await verifyInProcess(tmp, { skipStash: true, ref });
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
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
