/**
 * Spec-scan runner: clone a PR's head, run the (LLM-backed) scan + contract
 * generation, and persist the regenerated spec/contracts to the SERVER-SIDE
 * store keyed by `(owner/repo, head SHA)`. Nothing is committed back to the
 * customer's branch — the repo is read-only; the PR comment links to the
 * dashboard instead. The heavy pipeline is injectable so tests don't hit the LLM.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  scanInProcess,
  generateContractsInProcess,
} from '@truecourse/core/commands/spec-in-process';
import type { RepoRef } from '@truecourse/core/lib/contract-store';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';

/** The expensive spec→contract pipeline, abstracted for injection in tests. */
export interface SpecScanPipeline {
  /**
   * Consolidate spec docs and persist them under `ref` (`saveSpec`). Returns the
   * number of OPEN conflicts the merge couldn't resolve — these were
   * auto-defaulted to keep the pipeline moving, so a positive count means the
   * generated contracts encode a guess that a human should confirm.
   */
  scan(repoRoot: string, ref: RepoRef): Promise<{ openConflicts: number }>;
  /** Generate contracts and persist them under `ref` (`saveContracts`). Returns the file count. */
  generate(repoRoot: string, ref: RepoRef): Promise<{ fileCount: number }>;
}

export const defaultSpecScanPipeline: SpecScanPipeline = {
  async scan(repoRoot, ref) {
    // Fresh/shallow checkout → skipGit (fall back to filesystem mtime). The
    // explicit `ref` makes scan/generate ingest into the server-side store.
    const { scanState } = await scanInProcess(repoRoot, { skipGit: true, ref });
    return { openConflicts: scanState.openConflicts.length };
  },
  async generate(repoRoot, ref) {
    const res = await generateContractsInProcess(repoRoot, { skipGit: true, ref });
    if (res.il.kind === 'failed') throw res.il.error;
    if (res.il.kind === 'extracted') {
      return { fileCount: res.il.result.write.written.length };
    }
    return { fileCount: 0 };
  },
};

export interface SpecScanDeps {
  auth: GithubAuth;
  pipeline?: SpecScanPipeline;
}

export interface SpecScanRequest {
  repoFullName: string;
  installationId: number;
  headRef: string;
  /** PR head commit — the set is keyed by it (content-addressed cache). */
  headSha: string;
  prNumber: number;
}

export interface SpecScanResult {
  /** The head SHA whose spec/contracts were ingested server-side. */
  commitSha: string;
  /** Contract files generated and stored (0 ⇒ no spec docs to act on). */
  savedFileCount: number;
  /** Spec conflicts the scan couldn't resolve (auto-defaulted; need a human). */
  openConflicts: number;
}

export async function runSpecScan(
  deps: SpecScanDeps,
  req: SpecScanRequest,
): Promise<SpecScanResult> {
  const pipeline = deps.pipeline ?? defaultSpecScanPipeline;
  const ref: RepoRef = { repoKey: req.repoFullName, commitSha: req.headSha };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-scan-'));
  try {
    const token = await getInstallationToken(deps.auth, req.installationId);
    await simpleGit().clone(cloneUrl(req.repoFullName), tmp, [
      ...cloneAuthArgs(token),
      '--depth',
      '1',
      '--branch',
      req.headRef,
    ]);
    // Drop the token from the clone's remote config — defence in depth even
    // though we never write back.
    await stripEmbeddedAuth(simpleGit(tmp));

    // spec docs → claims.json → contracts/*.tc, all persisted server-side under
    // `ref`. The clone is read-only output; it is discarded below.
    const { openConflicts } = await pipeline.scan(tmp, ref);
    const { fileCount } = await pipeline.generate(tmp, ref);

    return { commitSha: req.headSha, savedFileCount: fileCount, openConflicts };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
