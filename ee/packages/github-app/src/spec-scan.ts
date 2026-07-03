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
import { saveContracts, listContractFiles, readContractFile, type RepoRef } from '@truecourse/core/lib/contract-store';
import {
  getInstallationToken,
  cloneUrl,
  cloneAuthArgs,
  stripEmbeddedAuth,
  type GithubAuth,
} from './github.js';

/** The generate manifest (area→specHash) `contracts generate` writes next to the
 *  `.tc` tree, relative to `.truecourse/contracts/`. Carried in the stored set. */
const GENERATE_MANIFEST = 'manifest.json';

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
    /** Fold the PR's decisions overlay (EE) — the PR-head scan sees its own
     *  PR-scoped resolutions, not just the repo row. Omitted for base/baseline. */
    opts?: { pr?: number },
  ): Promise<{ openConflicts: number }>;
  /** Generate contracts from the corpus and persist them under `ref`
   *  (`saveContracts`). Returns the file count. `tracker` (driven through
   *  CORPUS_GENERATE_STEPS) surfaces the popup's per-area contract progress. */
  generate(
    repoRoot: string,
    ref: RepoRef,
    tracker?: StepTracker,
    /** Phase 4: materialize this stored contract set into the clone first so an
     *  unchanged area anchors to it and reproduces its prior output. */
    anchorRef?: RepoRef,
  ): Promise<{ fileCount: number }>;
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
    // conflicts and never generates contracts (the dashboard resolve → regenerate
    // loop). Empty on the first (connect) scan, so conflicts surface as expected.
    // With `pr`, the effective decisions include that PR's overlay (overlay wins).
    const decisions = await getDecisions(ref.repoKey, opts);
    // Fresh/shallow checkout → skipGit (fall back to filesystem mtime). curate
    // writes corpus.json into the clone; we persist it under `ref` for the store.
    const { curate } = await curateInProcess(repoRoot, { skipGit: true, tracker, decisions });
    await saveSpec(ref, 'corpus', curate.corpus);
    return { openConflicts: curate.stats.overlapFlags };
  },
  async generate(repoRoot, ref, tracker, anchorRef) {
    if (!isLlmConfigured()) throw new Error(NO_LLM_PROVIDER_MESSAGE);
    // Phase 4 anchor: the clone has no committed contracts, so materialize the
    // base baseline's stored `.tc` into it before generating — then an unchanged
    // area reproduces its prior contract instead of drifting run-to-run.
    if (anchorRef) await materializeAnchorContracts(anchorRef, repoRoot);
    const { corpus } = await generateFromCorpusInProcess(repoRoot, { tracker });
    // A resolver-hard / failed corpus wrote nothing — surface it as a failure
    // (otherwise the gate saves a misleading "neutral, no contracts" baseline).
    if (corpus.kind === 'failed') throw corpus.error;
    if (corpus.kind === 'skipped') return { fileCount: 0 };
    // Persist the freshly generated `.tc` tree into the server-side store under `ref`.
    await saveContracts(ref, 'contracts', path.join(repoRoot, '.truecourse', 'contracts'));
    return { fileCount: corpus.result.write.written.length };
  },
};

/** Write a stored contract set's `.tc` files (plus its generate manifest) into
 *  `<repoRoot>/.truecourse/contracts/` so generation can anchor to them (the clone
 *  carries no committed contracts). Best-effort: a missing/unreadable base never
 *  fails generation. */
export async function materializeAnchorContracts(anchorRef: RepoRef, repoRoot: string): Promise<void> {
  try {
    const dir = path.join(repoRoot, '.truecourse', 'contracts');
    for (const rel of await listContractFiles(anchorRef.repoKey, 'contracts', anchorRef.commitSha)) {
      const content = await readContractFile(anchorRef.repoKey, 'contracts', rel, anchorRef.commitSha);
      if (content == null) continue;
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    // Also restore the anchor's generate manifest (excluded from listContractFiles)
    // so `classifyAreas` sees the prior specHashes and unchanged areas no-op — the
    // reviewed contracts reproduce byte-for-byte with zero LLM. Old sets have none
    // stored → skipped, and generation just falls back to per-area cache hits.
    const manifest = await readContractFile(anchorRef.repoKey, 'contracts', GENERATE_MANIFEST, anchorRef.commitSha);
    if (manifest != null) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, GENERATE_MANIFEST), manifest);
    }
  } catch {
    // Anchor is a bias, never a hard dependency — swallow and generate cold.
  }
}

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
