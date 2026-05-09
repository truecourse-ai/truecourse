/**
 * Top-level orchestrator. Wires every stage of the consolidator
 * together: discovery → slice → extract (cached) → merge → detect
 * modules → materialize (cached). Plus the side-channel reads/writes
 * for `decisions.json` (Q12 batch apply) and the cache layer.
 *
 * Two operating modes:
 *
 *   - **scan**   (`materialize: false`): runs through extraction +
 *     merge, returns the conflict list. The CLI's `spec scan`
 *     command, and the dashboard's initial "what's pending" view.
 *
 *   - **apply**  (`materialize: true`):  runs the full pipeline,
 *     writes `.truecourse/spec/`. The CLI's `spec apply`, and the
 *     dashboard's "Apply resolved" button.
 *
 * Cache integration is via runner-wrappers, so the per-block and
 * per-section LLM calls only fire on cache misses. Same hash inputs
 * → same outputs → no LLM cost for unchanged docs.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readBlockCache,
  writeBlockCache,
  readSectionCache,
  writeSectionCache,
  sectionId,
} from './cache.js';
import { detectModules, type DetectedModule } from './module-detector.js';
import { extractClaims, type ExtractResult } from './extractor.js';
import { materializeSpec, type MaterializeResult } from './materializer.js';
import { mergeClaims, type MergeResult } from './merger.js';
import { spawnRunner, type BlockRunner, type BlockRunResult } from './runner.js';
import type { Block } from './slicer.js';
import {
  spawnSectionRunner,
  type PendingSection,
  type RenderedSection,
  type SectionRunner,
} from './section-runner.js';
import { DecisionsFileSchema, type Claim, type DecisionsFile } from './types.js';

export interface ConsolidateOptions {
  /**
   * When true, write `.truecourse/spec/` from the merge result.
   * When false, return early after the merge with the conflict list.
   */
  materialize: boolean;
  /** Override block-extraction runner. Tests pass a stub. */
  blockRunner?: BlockRunner;
  /** Override section-rendering runner. Tests pass a stub. */
  sectionRunner?: SectionRunner;
  /**
   * Skip the git-log mtime resolution. Useful for tests; the harness
   * also passes this when the working dir isn't a git repo.
   */
  skipGit?: boolean;
  /** Hooks for progress UIs / logging. */
  onDocStart?: (doc: import('./discovery.js').DocCandidate) => void;
  onDocDone?: (doc: import('./discovery.js').DocCandidate, blockCount: number, claimCount: number) => void;
  onBlockFailure?: (block: Block, error: string) => void;
  onSectionDone?: (section: RenderedSection) => void;
}

export interface ConsolidateResult {
  /** Extraction stats — block count, failures, doc count. */
  extract: ExtractResult;
  /** Merge result — resolved + decided + open conflicts. */
  merge: MergeResult;
  /** Modules detected from the merged claim set; absent in scan mode. */
  modules?: DetectedModule[];
  /** Materialization result — written paths + per-section failures. */
  materialize?: MaterializeResult;
  /**
   * The decisions file the orchestrator read from disk (or the empty
   * default if none existed). Echoed in the result so callers can
   * inspect what informed the merge.
   */
  decisions: DecisionsFile;
}

/**
 * Run the consolidator against `repoRoot`.
 */
export async function consolidate(
  repoRoot: string,
  opts: ConsolidateOptions,
): Promise<ConsolidateResult> {
  const decisions = readDecisions(repoRoot);

  // ---- Extract (cache-wrapped) ------------------------------------------
  const blockRunner = wrapBlockRunner(repoRoot, opts.blockRunner ?? spawnRunner());
  const extract = await extractClaims(repoRoot, {
    runner: blockRunner,
    skipGit: opts.skipGit,
    onDocStart: opts.onDocStart,
    onDocDone: opts.onDocDone,
    onBlockFailure: opts.onBlockFailure,
  });

  // ---- Merge -----------------------------------------------------------
  const merge = mergeClaims(extract.claims, decisions);

  if (!opts.materialize) {
    return { extract, merge, decisions };
  }

  // ---- Detect modules + materialize (cache-wrapped section runner) -----
  const renderable = collectRenderableClaims(merge);
  const modules = detectModules(renderable).modules;
  const sectionRunner = wrapSectionRunner(
    repoRoot,
    opts.sectionRunner ?? spawnSectionRunner(),
  );
  const specRoot = specRootPath(repoRoot);
  const materialize = await materializeSpec(
    specRoot,
    merge,
    modules,
    decisions,
    {
      runner: sectionRunner,
      onSectionDone: opts.onSectionDone,
    },
  );

  return { extract, merge, modules, materialize, decisions };
}

// ---------------------------------------------------------------------------
// Decisions file I/O
// ---------------------------------------------------------------------------

const EMPTY_DECISIONS: DecisionsFile = { version: 1, decisions: [] };

export function decisionsPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'spec', 'decisions.json');
}

export function specRootPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'spec');
}

/**
 * Read `decisions.json` from the repo's `.truecourse/spec/` dir.
 * Returns an empty decisions file if missing or unparseable —
 * stale/corrupt files shouldn't block a scan run.
 */
export function readDecisions(repoRoot: string): DecisionsFile {
  const file = decisionsPath(repoRoot);
  if (!fs.existsSync(file)) return EMPTY_DECISIONS;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return DecisionsFileSchema.parse(raw);
  } catch {
    return EMPTY_DECISIONS;
  }
}

/**
 * Write `decisions.json`. Used by the CLI's `spec resolve` flow and
 * the dashboard write-back endpoint.
 */
export function writeDecisions(repoRoot: string, decisions: DecisionsFile): void {
  const file = decisionsPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(decisions, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Cache-wrapping runners
// ---------------------------------------------------------------------------

function wrapBlockRunner(repoRoot: string, inner: BlockRunner): BlockRunner {
  return async (blocks) => {
    const out: BlockRunResult[] = [];
    const misses: Block[] = [];
    for (const block of blocks) {
      const cached = readBlockCache(repoRoot, block.id);
      if (cached) {
        out.push({ block, extraction: cached, durationMs: 0 });
      } else {
        misses.push(block);
      }
    }
    if (misses.length === 0) return out;
    const innerResults = await inner(misses);
    for (const r of innerResults) {
      if (r.extraction) writeBlockCache(repoRoot, r.block.id, r.extraction);
      out.push(r);
    }
    return out;
  };
}

function wrapSectionRunner(repoRoot: string, inner: SectionRunner): SectionRunner {
  return async (sections) => {
    const out: RenderedSection[] = [];
    const misses: PendingSection[] = [];
    for (const section of sections) {
      const id = sectionId(section);
      const cached = readSectionCache(repoRoot, id);
      if (cached) {
        out.push({
          module: section.module,
          topic: section.topic,
          fileName: section.fileName,
          markdown: cached,
          durationMs: 0,
        });
      } else {
        misses.push(section);
      }
    }
    if (misses.length === 0) return out;
    const innerResults = await inner(misses);
    for (const r of innerResults) {
      if (r.markdown) {
        const id = sectionId({
          module: r.module,
          topic: r.topic,
          fileName: r.fileName,
          claims: misses.find((s) => s.module === r.module && s.fileName === r.fileName)?.claims ?? [],
        });
        writeSectionCache(repoRoot, id, {
          module: r.module,
          topic: r.topic,
          fileName: r.fileName,
          markdown: r.markdown,
        });
      }
      out.push(r);
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// Internal: which claims feed materialization?
// ---------------------------------------------------------------------------

function collectRenderableClaims(merge: MergeResult): Claim[] {
  const out: Claim[] = [...merge.resolvedClaims];
  for (const decided of merge.decidedConflicts) {
    if (decided.resolvedClaim) out.push(decided.resolvedClaim);
    // Custom-resolution claims are synthesized inside the
    // materializer itself (it has the resolution payload). Avoid
    // double-counting here.
  }
  return out;
}
