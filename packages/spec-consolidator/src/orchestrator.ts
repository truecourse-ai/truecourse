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
import { mergeClaims, type DecidedConflict, type MergeResult } from './merger.js';
import { spawnRunner, type BlockRunner, type BlockRunResult } from './runner.js';
import type { Block } from './slicer.js';
import {
  spawnSectionRunner,
  type PendingSection,
  type RenderedSection,
  type SectionRunner,
} from './section-runner.js';
import {
  DecisionsFileSchema,
  type Claim,
  type Conflict,
  type ConflictCandidate,
  type DecisionsFile,
} from './types.js';
import { detectVersionChains, type VersionChain } from './version-chain.js';
import {
  detectVersionChainsViaLlm,
  type ChainRunner,
} from './version-chain-llm.js';
import { discoverDocs, type DocCandidate } from './discovery.js';

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
   * Override the LLM chain-detection runner. Tests pass a stub.
   * When omitted, an LLM-backed runner is spawned automatically. Set
   * `disableLlmChainDetection: true` to skip the LLM call entirely.
   */
  chainRunner?: ChainRunner;
  /**
   * When true, skip the LLM chain-detection step. The deterministic
   * detector still runs. Useful for tests and offline runs.
   */
  disableLlmChainDetection?: boolean;
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

  // ---- Discover (twice — once here for chain detection, once inside
  //              extractClaims). Discovery is cheap and deterministic
  //              so the duplication is negligible.
  const docs = discoverDocs(repoRoot, { skipGit: opts.skipGit });

  // ---- Detect version chains (deterministic + LLM-augmented) ----------
  // Deterministic detector catches filename versioning (v1/v2) — cheap,
  // free, no model call. The LLM-based detector adds chains that don't
  // follow the filename convention. Both run; results are merged with
  // deterministic findings winning on overlap so the labels we attach
  // later stay accurate.
  const deterministicChains = detectVersionChains(docs);
  const llmChains = await detectVersionChainsViaLlm(repoRoot, docs, {
    runner: opts.chainRunner,
    enabled: opts.disableLlmChainDetection !== true,
  });
  const chains = mergeChainResults(deterministicChains, llmChains);
  const chainConflicts = chains.map(synthesizeChainConflict);
  const winnersByChain = resolveChainWinners(chainConflicts, decisions);

  // ---- Extract (cache-wrapped) -----------------------------------------
  const blockRunner = wrapBlockRunner(repoRoot, opts.blockRunner ?? spawnRunner());
  const extract = await extractClaims(repoRoot, {
    runner: blockRunner,
    skipGit: opts.skipGit,
    onDocStart: opts.onDocStart,
    onDocDone: opts.onDocDone,
    onBlockFailure: opts.onBlockFailure,
  });

  // ---- Apply chain decisions: drop claims from superseded docs ---------
  const filteredClaims = filterByChainWinners(extract.claims, chains, winnersByChain);

  // ---- Enrich chain conflicts with per-doc stats -----------------------
  // The dashboard renders a more informative preview when each chain
  // candidate carries claim counts + topic breakdown, so the user can
  // see "v1 has 8 claims (auth, endpoints); v2 has 22 (auth,
  // endpoints, data, effects)" instead of just a 5-line snippet.
  const enrichedChainConflicts = enrichChainConflictsWithStats(chainConflicts, extract.claims);

  // ---- Merge -----------------------------------------------------------
  const merge = mergeClaims(filteredClaims, decisions);

  // ---- Stitch chain conflicts into the merge result --------------------
  // Chains without a decision surface in openConflicts; chains with one
  // surface in decidedConflicts. Either way the dashboard sees them
  // through the same shape as content conflicts.
  const stitchedMerge = stitchChainConflicts(merge, enrichedChainConflicts, decisions);

  if (!opts.materialize) {
    return { extract, merge: stitchedMerge, decisions };
  }

  // ---- Detect modules + materialize (cache-wrapped section runner) -----
  const renderable = collectRenderableClaims(stitchedMerge);
  const modules = detectModules(renderable).modules;
  const sectionRunner = wrapSectionRunner(
    repoRoot,
    opts.sectionRunner ?? spawnSectionRunner(),
  );
  const specRoot = specRootPath(repoRoot);
  const materialize = await materializeSpec(
    specRoot,
    stitchedMerge,
    modules,
    decisions,
    {
      runner: sectionRunner,
      onSectionDone: opts.onSectionDone,
    },
  );

  return { extract, merge: stitchedMerge, modules, materialize, decisions };
}

// ---------------------------------------------------------------------------
// Version chain → Conflict synthesis
// ---------------------------------------------------------------------------

/**
 * Turn a detected chain into a Conflict the dashboard can display
 * with the same component as content conflicts. Each candidate is a
 * synthetic Claim representing one doc in the chain — the LLM never
 * sees these; they exist only at the merge layer for surfacing.
 */
function synthesizeChainConflict(chain: VersionChain): Conflict {
  const candidates: ConflictCandidate[] = chain.docs.map((doc, index) => ({
    index,
    weight:
      index === 0
        ? 'oldest'
        : index === chain.docs.length - 1
          ? 'newest'
          : index < chain.docs.length / 2
            ? 'older'
            : 'newer',
    claim: docToSyntheticClaim(doc, chain),
  }));
  return {
    id: chain.id,
    topic: 'overview',
    subject: `version chain: ${chain.docs.map((d) => path.basename(d.path)).join(' → ')}`,
    candidates,
    defaultPick: candidates.length - 1,
  };
}

/** How many cleaned lines to surface in chain candidate previews. */
const CHAIN_PREVIEW_LINES = 80;

function docToSyntheticClaim(doc: DocCandidate, chain: VersionChain): Claim {
  const cleaned = stripHtmlComments(doc.preview);
  const preview = cleaned.split('\n').slice(0, CHAIN_PREVIEW_LINES).join('\n');
  return {
    id: `version-chain:${chain.id}:${doc.path}`,
    topic: 'overview',
    subject: `version chain: ${chain.docs.map((d) => path.basename(d.path)).join(' → ')}`,
    content: {
      file: doc.path,
      detectedFrom: chain.detectedFrom,
      preview,
    },
    kind: 'definition',
    provenance: {
      file: doc.path,
      line: 1,
      // Same preview the UI renders — keep `quote` and `content.preview`
      // in sync so the dashboard sees one source of truth.
      quote: preview,
    },
    metadata: {
      docKind: doc.kind,
      lastTouched: doc.lastTouched,
    },
  };
}

/**
 * Merge deterministic and LLM-detected chains. Deduplication is by
 * chain id (which is sha256 of the sorted member paths), so any chain
 * the LLM found that the deterministic detector also found gets
 * dropped from the LLM list — the deterministic `filename` label is
 * more informative than the generic `llm` tag, so we keep it.
 */
function mergeChainResults(
  deterministic: VersionChain[],
  llm: VersionChain[],
): VersionChain[] {
  const seen = new Set(deterministic.map((c) => c.id));
  const out = [...deterministic];
  for (const chain of llm) {
    if (seen.has(chain.id)) continue;
    seen.add(chain.id);
    out.push(chain);
  }
  return out;
}

/**
 * Attach per-doc claim stats to each chain candidate. The candidate's
 * content gains:
 *
 *   - claimCount: how many claims this doc contributed
 *   - topics:     count of claims grouped by topic
 *   - subjects:   up to N (currently 8) representative subject strings
 *
 * These show up in the dashboard's version-chain UI as concrete
 * impact info — much more useful for the "which doc is canonical?"
 * decision than a 5-line text preview.
 */
function enrichChainConflictsWithStats(
  chainConflicts: Conflict[],
  allClaims: Claim[],
): Conflict[] {
  if (chainConflicts.length === 0) return chainConflicts;
  // Index claims by source file once.
  const claimsByFile = new Map<string, Claim[]>();
  for (const c of allClaims) {
    const list = claimsByFile.get(c.provenance.file) ?? [];
    list.push(c);
    claimsByFile.set(c.provenance.file, list);
  }
  return chainConflicts.map((conflict) => ({
    ...conflict,
    candidates: conflict.candidates.map((cand) => {
      const file = (cand.claim.content as { file?: string } | undefined)?.file
        ?? cand.claim.provenance.file;
      const docClaims = claimsByFile.get(file) ?? [];
      const topics: Record<string, number> = {};
      for (const c of docClaims) topics[c.topic] = (topics[c.topic] ?? 0) + 1;
      const subjects = docClaims
        .map((c) => c.subject)
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .slice(0, 8);
      return {
        ...cand,
        claim: {
          ...cand.claim,
          content: {
            ...(cand.claim.content as Record<string, unknown>),
            claimCount: docClaims.length,
            topics,
            subjects,
          },
        },
      };
    }),
  }));
}

/**
 * Strip HTML comments before slicing a preview snippet. Without this,
 * a comment that opens before our 3/5-line cutoff but closes after it
 * leaks the open `<!--` into the rendered preview as raw text. Real
 * docs commonly carry `<!-- TODO -->` markers, fixture annotations,
 * and the like — none of which belong in a "what is this doc about"
 * snippet.
 */
function stripHtmlComments(text: string): string {
  // Drop fully-closed comments first (may span lines).
  let out = text.replace(/<!--[\s\S]*?-->/g, '');
  // Drop any trailing unclosed comment opener so a half-comment at
  // the tail of the doc doesn't leak through.
  const lastOpen = out.lastIndexOf('<!--');
  if (lastOpen !== -1 && out.indexOf('-->', lastOpen) === -1) {
    out = out.slice(0, lastOpen);
  }
  // Collapse any blank-line runs left behind by removed comments.
  return out.replace(/\n{3,}/g, '\n\n').trimStart();
}

/**
 * For each chain conflict, look up the user's decision (if any) and
 * record which doc path "won". A `pick` resolution selects one doc
 * exclusively; a `custom` resolution is interpreted as "merge both"
 * — claims from every doc in the chain pass through unfiltered.
 */
function resolveChainWinners(
  chainConflicts: Conflict[],
  decisions: DecisionsFile,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const conflict of chainConflicts) {
    const decision = decisions.decisions.find((d) => d.conflictId === conflict.id);
    if (!decision) {
      out.set(conflict.id, null); // pending — surface as openConflict
      continue;
    }
    if (decision.resolution.kind === 'pick') {
      const idx = decision.resolution.candidateIndex;
      const winnerClaim = conflict.candidates[idx]?.claim;
      const winnerFile = (winnerClaim?.content as { file?: string } | undefined)?.file ?? null;
      out.set(conflict.id, winnerFile);
    } else {
      // 'custom' — treat as "merge both": no filtering.
      out.set(conflict.id, null);
    }
  }
  return out;
}

/**
 * Drop claims from docs that the user superseded. Claims from docs
 * not in any chain (or in chains with no winner decided yet) pass
 * through.
 */
function filterByChainWinners(
  claims: Claim[],
  chains: VersionChain[],
  winnersByChain: Map<string, string | null>,
): Claim[] {
  const dropFiles = new Set<string>();
  for (const chain of chains) {
    const winner = winnersByChain.get(chain.id);
    if (!winner) continue; // no decision yet OR custom (merge-both)
    for (const doc of chain.docs) {
      if (doc.path !== winner) dropFiles.add(doc.path);
    }
  }
  if (dropFiles.size === 0) return claims;
  return claims.filter((c) => !dropFiles.has(c.provenance.file));
}

/**
 * Add chain conflicts to the merge result so the dashboard sees
 * everything in one shape. Pending chains → openConflicts. Decided
 * chains → decidedConflicts.
 */
function stitchChainConflicts(
  merge: MergeResult,
  chainConflicts: Conflict[],
  decisions: DecisionsFile,
): MergeResult {
  const pending: Conflict[] = [];
  const decided: DecidedConflict[] = [];
  for (const conflict of chainConflicts) {
    const decision = decisions.decisions.find((d) => d.conflictId === conflict.id);
    if (!decision) {
      pending.push(conflict);
      continue;
    }
    decided.push({
      conflict,
      decision,
      resolvedClaim:
        decision.resolution.kind === 'pick'
          ? conflict.candidates[decision.resolution.candidateIndex]?.claim
          : undefined,
    });
  }
  return {
    resolvedClaims: merge.resolvedClaims,
    decidedConflicts: [...decided, ...merge.decidedConflicts],
    openConflicts: [...pending, ...merge.openConflicts],
  };
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
    if (!decided.resolvedClaim) continue;
    // Version-chain synthetic claims are metadata about the user's
    // supersede decision — not real spec content. Filter them out so
    // they don't end up rendered as a "version chain: …" overview
    // file in the canonical.
    if (decided.resolvedClaim.id.startsWith('version-chain:')) continue;
    out.push(decided.resolvedClaim);
    // Custom-resolution claims are synthesized inside the
    // materializer itself (it has the resolution payload). Avoid
    // double-counting here.
  }
  return out;
}
