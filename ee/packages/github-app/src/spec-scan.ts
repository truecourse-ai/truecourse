/**
 * Spec-scan runner: clone a PR's head, run the (LLM-backed) scan, and persist the
 * regenerated corpus to the SERVER-SIDE store keyed by `(owner/repo, head SHA)`.
 * Nothing is committed back to the customer's branch — the repo is read-only; the
 * PR comment links to the dashboard instead. The heavy pipeline is injectable so
 * tests don't hit the LLM.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  curateInProcess,
  getDecisions,
  materializeWorkspaceInheritance,
} from '@truecourse/core/commands/spec-in-process';
import { saveSpec } from '@truecourse/core/lib/spec-store';
import { writeDecisions, resolveRepoIdentity } from '@truecourse/spec-consolidator';
import { isLlmConfigured, NO_LLM_PROVIDER_MESSAGE } from '@truecourse/shared/llm';
import type { StepTracker } from '@truecourse/core/progress';
import type { RepoRef } from '@truecourse/core/lib/contract-store';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';

/** The expensive spec-scan pipeline, abstracted for injection in tests. */
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
    /** Fold the PR's decisions overlay (EE) — the PR-head scan sees its own
     *  PR-scoped resolutions, not just the repo row. Omitted for base/baseline. */
    opts?: { pr?: number },
  ): Promise<{ openConflicts: number }>;
}

export const defaultSpecScanPipeline: SpecScanPipeline = {
  async scan(repoRoot, ref, tracker, opts) {
    // Fail loudly BEFORE any LLM work when no provider is configured — otherwise
    // the curate fail-open handling swallows it and the gate "completes" with no
    // corpus (and EE must never fall back to the `claude` CLI).
    if (!isLlmConfigured()) throw new Error(NO_LLM_PROVIDER_MESSAGE);
    // The user's resolutions (relations / manual areas / includes) live in the
    // server store (Postgres), keyed by repoKey — NOT in this fresh clone. Load
    // them and fold them into curate, else the re-scan re-detects already-resolved
    // conflicts (the dashboard resolve → re-scan loop). Empty on the first (connect)
    // scan, so conflicts surface as expected. With `pr`, the effective decisions
    // include that PR's overlay (overlay wins).
    const repoDecisions = await getDecisions(ref.repoKey, opts);
    // Fold the workspace Knowledge layer into the checkout BEFORE curate (hosted):
    // materialize every workspace doc body at its `knowledge/<kind>/<id>.md` path so
    // curate sees one doc universe (inherited docs are cache hits), and merge the
    // workspace decisions UNDER the repo's own (repo wins). Inert in OSS / a repo
    // with no workspace — the repo's own decisions pass through unchanged.
    const { decisions } = await materializeWorkspaceInheritance(repoRoot, ref.repoKey, repoDecisions);
    // Persist the effective (merged) decisions into the checkout so a generate over
    // this same tree — the PR-head regen runs scan then generate in one clone — reads
    // them from `decisions.json` (its conflict gate + losing-side suppression do), not
    // just this curate. Transient: the clone is discarded after.
    writeDecisions(repoRoot, decisions);
    // Fresh/shallow checkout → skipGit (fall back to filesystem mtime). curate
    // writes corpus.json into the clone; we persist it under `ref` for the store.
    // State who this repo IS to the relevance classifier. `ref.repoKey` is the
    // authoritative `owner/repo`, so no filesystem probing: this checkout is a
    // shallow clone in a temp dir named `tc-gate-scan-XXXX`, and resolving from
    // the tree would offer that scratch name as the product's identity.
    const repoIdentity = resolveRepoIdentity({ repoFullName: ref.repoKey });
    const { curate } = await curateInProcess(repoRoot, {
      skipGit: true,
      tracker,
      decisions,
      repoIdentity,
    });
    await saveSpec(ref, 'corpus', curate.corpus);
    return { openConflicts: curate.stats.overlapFlags };
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
  /** PR head commit — the corpus is keyed by it (content-addressed cache). */
  headSha: string;
  prNumber: number;
}

export interface SpecScanResult {
  /** The head SHA whose corpus was ingested server-side. */
  commitSha: string;
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

    // spec docs → corpus.json, persisted server-side under `ref`. The clone is
    // read-only output; it is discarded below.
    const { openConflicts } = await pipeline.scan(tmp, ref);

    return { commitSha: req.headSha, openConflicts };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
