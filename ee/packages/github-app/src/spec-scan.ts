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
  curateInProcess,
  generateFromCorpusInProcess,
  getDecisions,
} from '@truecourse/core/commands/spec-in-process';
import { saveSpec } from '@truecourse/core/lib/spec-store';
import { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '@truecourse/shared/llm';
import type { StepTracker } from '@truecourse/core/progress';
import { saveContracts, type RepoRef } from '@truecourse/core/lib/contract-store';
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
   * Curate the repo's spec docs into a corpus and persist it under `ref`
   * (`saveSpec(ref, 'corpus', …)`). Returns the number of within-area OVERLAPS
   * the curation flagged but no relation resolved — the corpus-path analog of
   * "open conflicts": a positive count means docs in an area may disagree and a
   * human should pick a relation.
   */
  scan(
    repoRoot: string,
    ref: RepoRef,
    tracker?: StepTracker,
  ): Promise<{ openConflicts: number }>;
  /** Generate contracts from the corpus and persist them under `ref`
   *  (`saveContracts`). Returns the file count. The progress callbacks are kept
   *  for interface compatibility (corpus generate reports per-area, not per-slice). */
  generate(
    repoRoot: string,
    ref: RepoRef,
    onSliceProgress?: (done: number, total: number) => void,
    onRepairProgress?: (done: number, total: number) => void,
  ): Promise<{ fileCount: number }>;
}

export const defaultSpecScanPipeline: SpecScanPipeline = {
  async scan(repoRoot, ref, tracker) {
    // Fail loudly BEFORE any LLM work when no provider is configured — otherwise
    // the curate fail-open handling swallows it and the gate "completes" with no
    // corpus (and EE must never fall back to the `claude` CLI).
    if (!isLlmConfigured()) throw new Error(NO_LLM_PROVIDER_MESSAGE);
    // The user's resolutions (relations / manual areas / includes) live in the
    // server store (Postgres), keyed by repoKey — NOT in this fresh clone. Load
    // them and fold them into curate, else the re-scan re-detects already-resolved
    // conflicts and never generates contracts (the dashboard resolve → regenerate
    // loop). Empty on the first (connect) scan, so conflicts surface as expected.
    const decisions = await getDecisions(ref.repoKey);
    // Fresh/shallow checkout → skipGit (fall back to filesystem mtime). curate
    // writes corpus.json into the clone; we persist it under `ref` for the store.
    const { curate } = await curateInProcess(repoRoot, { skipGit: true, tracker, decisions });
    await saveSpec(ref, 'corpus', curate.corpus);
    return { openConflicts: curate.stats.overlapFlags };
  },
  async generate(repoRoot, ref) {
    if (!isLlmConfigured()) throw new Error(NO_LLM_PROVIDER_MESSAGE);
    const { corpus } = await generateFromCorpusInProcess(repoRoot);
    // A resolver-hard / failed corpus wrote nothing — surface it as a failure
    // (otherwise the gate saves a misleading "neutral, no contracts" baseline).
    if (corpus.kind === 'failed') throw corpus.error;
    if (corpus.kind === 'skipped') return { fileCount: 0 };
    // Persist the freshly generated `.tc` tree into the server-side store under `ref`.
    await saveContracts(ref, 'contracts', path.join(repoRoot, '.truecourse', 'contracts'));
    return { fileCount: corpus.result.write.written.length };
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

    // spec docs → corpus.json → contracts/*.tc, all persisted server-side under
    // `ref`. The clone is read-only output; it is discarded below.
    const { openConflicts } = await pipeline.scan(tmp, ref);
    const { fileCount } = await pipeline.generate(tmp, ref);

    return { commitSha: req.headSha, savedFileCount: fileCount, openConflicts };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
