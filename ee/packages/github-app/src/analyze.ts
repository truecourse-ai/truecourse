/**
 * Server-side full analysis, triggered when the default branch advances (a
 * merge). Clones the default branch and runs the full analyze pipeline on the
 * clone, storing the result server-side keyed by the repo identity
 * (`owner/repo`) — so the hosted dashboard shows analyses without anyone running
 * the CLI. Read-only on the customer's repo; the clone is discarded.
 *
 * Registering the repo here also surfaces it in the dashboard's project list
 * (the registry), so a connected GitHub repo appears once its default branch is
 * analyzed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { analyzeInProcess } from '@truecourse/core/commands/analyze-in-process';
import { registerProject } from '@truecourse/core/config/registry';
import { log } from '@truecourse/core/lib/logger';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';

export interface AnalyzeDeps {
  auth: GithubAuth;
}

export interface AnalyzeRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
}

export async function runRepoAnalyze(deps: AnalyzeDeps, req: AnalyzeRequest): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-analyze-'));
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

    // Surface the repo in the dashboard registry (keyed by `owner/repo`, with a
    // deterministic slug) and analyze the clone, stored under that identity.
    const project = await registerProject(req.repoFullName, req.repoFullName);
    await analyzeInProcess(project, {
      codeDir: tmp,
      branch: req.defaultBranch,
      commitHash: req.commitSha,
      skipStash: true, // the clone is clean — nothing to stash
    });
    log.info(`[github-app] analyzed ${req.repoFullName}@${req.commitSha.slice(0, 7)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
