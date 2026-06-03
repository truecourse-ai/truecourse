/**
 * Infer runner: clone a PR's head, reverse-engineer undocumented decisions from
 * the code (LLM-backed `inferInProcess`), and persist the inferred contracts to
 * the SERVER-SIDE store under `(owner/repo, head SHA)` as the
 * `contracts_inferred` kind. Nothing is committed back to the PR branch — the
 * repo is read-only. The heavy pipeline is injectable so tests don't hit the LLM.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { inferInProcess } from '@truecourse/core/commands/spec-in-process';
import type { RepoRef } from '@truecourse/core/lib/contract-store';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';
import type { DecisionSummary } from './infer-comment.js';

/** The expensive inference pipeline, abstracted for injection in tests. */
export interface InferPipeline {
  /** Infer undocumented decisions and persist them under `ref` (`saveContracts`). */
  infer(repoRoot: string, ref: RepoRef): Promise<DecisionSummary[]>;
}

const defaultPipeline: InferPipeline = {
  async infer(repoRoot, ref) {
    const { infer } = await inferInProcess(repoRoot, { ref });
    return infer.decisions.map((d) => ({
      kind: d.kind,
      identity: d.identity,
      path: d.codeLoc?.path,
      line: d.codeLoc?.lines?.[0],
      reason: d.reason,
    }));
  },
};

export interface InferDeps {
  auth: GithubAuth;
  pipeline?: InferPipeline;
}

export interface InferRequest {
  repoFullName: string;
  installationId: number;
  headRef: string;
  /** PR head commit — the inferred set is keyed by it. */
  headSha: string;
  prNumber: number;
}

export interface InferResultSummary {
  decisions: DecisionSummary[];
  /** The head SHA whose inferred contracts were ingested server-side. */
  commitSha: string;
}

export async function runInfer(
  deps: InferDeps,
  req: InferRequest,
): Promise<InferResultSummary> {
  const pipeline = deps.pipeline ?? defaultPipeline;
  const ref: RepoRef = { repoKey: req.repoFullName, commitSha: req.headSha };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-infer-'));
  try {
    const token = await getInstallationToken(deps.auth, req.installationId);
    await simpleGit().clone(cloneUrl(req.repoFullName), tmp, [
      ...cloneAuthArgs(token),
      '--depth',
      '1',
      '--branch',
      req.headRef,
    ]);
    await stripEmbeddedAuth(simpleGit(tmp));

    const decisions = await pipeline.infer(tmp, ref);
    return { decisions, commitSha: req.headSha };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
