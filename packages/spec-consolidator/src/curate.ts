/**
 * The curated-corpus pipeline (spec-scan redesign, Phase 1) — the corpus-path
 * counterpart to `orchestrator.ts:consolidate()`. It NEVER extracts claims,
 * merges, detects conflicts, or auto-resolves. It curates docs:
 *
 *   discover → relevance keep/drop → tag each DOC with its AREAS →
 *   group docs by area → detect doc→doc RELATIONS (filename + one LLM pass) →
 *   flag within-area OVERLAPS (skipping pairs a relation already resolves) →
 *   assemble + persist a CuratedCorpus (corpus.json).
 *
 * Runs ALONGSIDE the legacy `consolidate()` during the migration (both paths
 * live across Phases 1–2). It reuses the kept stages — discovery, the relevance
 * filter, the deterministic filename detector, the LLM chain pass — and adds the
 * three corpus stages (area-tagger, area-grouper, overlap-detector).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { LlmTransport } from '@truecourse/shared/llm';
import { discoverDocs, type DocCandidate } from './discovery.js';
import { filterByRelevance, type RelevanceRunner } from './relevance-filter.js';
import { tagDocs, type AreaTagRunner } from './area-tagger.js';
import { normalizeVocabulary, type VocabRunner } from './vocab-normalizer.js';
import { groupByArea } from './area-grouper.js';
import { detectRelations, effectiveRelations } from './relation.js';
import { flagOverlaps, type OverlapRunner } from './overlap-detector.js';
import { writeCorpus } from './corpus-store.js';
import { DecisionsFileSchema, type DecisionsFile, type Relation } from './types.js';
import { type Area, type CuratedCorpus } from './corpus-types.js';
import type { ChainRunner } from './version-chain-llm.js';

/** Per-stage model overrides for the curate pipeline. */
export interface CurateModels {
  relevance?: string;
  areaTag?: string;
  vocab?: string;
  overlap?: string;
  relation?: string;
  /** Forwarded as `--fallback-model` to every stage. */
  fallback?: string;
}

export interface CurateOptions {
  /** Per-stage model overrides (resolved upstream via core's `resolveModel`). */
  models?: CurateModels;
  /** LLM transport for the auto-created runners. Defaults to the cli transport. */
  transport?: LlmTransport;
  /** Inject the doc set instead of walking the filesystem (EE). */
  docSource?: () => DocCandidate[] | Promise<DocCandidate[]>;
  /** Inject the decisions file instead of reading `decisions.json` from disk. */
  decisions?: DecisionsFile;
  /** Skip git-log mtime resolution (tests / non-git dirs). */
  skipGit?: boolean;
  /** Skip writing `corpus.json`. The corpus is still assembled + returned. */
  skipCorpusWrite?: boolean;

  // --- stage runner overrides + disable flags (tests inject stubs) ----------
  relevanceRunner?: RelevanceRunner;
  disableRelevanceFilter?: boolean;
  areaTagRunner?: AreaTagRunner;
  disableAreaTagging?: boolean;
  vocabRunner?: VocabRunner;
  disableVocabNormalization?: boolean;
  relationChainRunner?: ChainRunner;
  disableLlmRelationDetection?: boolean;
  overlapRunner?: OverlapRunner;
  disableOverlapDetection?: boolean;

  // --- progress hooks -------------------------------------------------------
  onRelevanceProgress?: (done: number, total: number) => void;
  onTagProgress?: (done: number, total: number) => void;
  onOverlapProgress?: (done: number, total: number) => void;
}

export interface CurateStats {
  docsScanned: number;
  docsKept: number;
  areaCount: number;
  overlapFlags: number;
  resolvedRelations: number;
  /** Overlaps still awaiting a relation — carries refs; passages derived at display. */
  openOverlaps: Array<{ area: string; a: string; b: string }>;
  skippedDocs: Array<{ path: string; reason: string }>;
}

export interface CurateResult {
  /** The assembled corpus (whether or not it was written to disk). */
  corpus: CuratedCorpus;
  /** Effective relations = auto-detected ∪ user-authored. */
  relations: Relation[];
  /** Docs the relevance filter dropped, with reasons. */
  skippedDocs: Array<{ path: string; reason: string }>;
  /** The decisions file that informed the run. */
  decisions: DecisionsFile;
  /** Summary counts for scan-state / CLI output. */
  stats: CurateStats;
}

/**
 * Run the curate pipeline against `repoRoot`.
 */
export async function curate(repoRoot: string, opts: CurateOptions = {}): Promise<CurateResult> {
  const decisions = opts.decisions ?? readCorpusDecisions(repoRoot);
  const models = opts.models ?? {};
  const fallbackModel = models.fallback;

  // ---- Discover -------------------------------------------------------
  const allDocs = opts.docSource ? await opts.docSource() : discoverDocs(repoRoot, { skipGit: opts.skipGit });

  // ---- Relevance keep/drop --------------------------------------------
  const relevance = await filterByRelevance(repoRoot, allDocs, {
    runner: opts.relevanceRunner,
    enabled: opts.disableRelevanceFilter !== true,
    manualIncludes: decisions.manualIncludes ?? [],
    transport: opts.transport,
    model: models.relevance,
    fallbackModel,
    onProgress: opts.onRelevanceProgress,
  });
  const docs = relevance.included;
  const skippedDocs = relevance.skipped.map(({ doc, reason }) => ({ path: doc.path, reason }));

  // ---- Tag each doc with its areas ------------------------------------
  const tagsByPath = await tagDocs(repoRoot, docs, {
    runner: opts.areaTagRunner,
    enabled: opts.disableAreaTagging !== true,
    transport: opts.transport,
    model: models.areaTag,
    fallbackModel,
    onProgress: opts.onTagProgress,
  });

  // ---- Reconcile emergent vocabulary (collapse cross-doc name drift) --
  const vocab = await normalizeVocabulary(repoRoot, tagsByPath, {
    runner: opts.vocabRunner,
    enabled: opts.disableVocabNormalization !== true,
    transport: opts.transport,
    model: models.vocab,
    fallbackModel,
  });

  // ---- Group docs by area ---------------------------------------------
  const grouped = groupByArea(docs, tagsByPath, decisions.manualAreas ?? [], vocab);

  // ---- Detect relations (auto) + fold in user relations ---------------
  const autoRelations = await detectRelations(repoRoot, docs, {
    chainRunner: opts.relationChainRunner,
    disableLlm: opts.disableLlmRelationDetection,
    transport: opts.transport,
    model: models.relation,
    fallbackModel,
  });
  const relations = effectiveRelations(autoRelations, decisions.relations ?? []);

  // ---- Flag within-area overlaps (skip relation-resolved pairs) -------
  const overlapsByArea = await flagOverlaps(repoRoot, grouped.areas, docs, {
    runner: opts.overlapRunner,
    enabled: opts.disableOverlapDetection !== true,
    relations,
    transport: opts.transport,
    model: models.overlap,
    fallbackModel,
    onProgress: opts.onOverlapProgress,
  });
  const areas: Area[] = grouped.areas.map((a) => ({ ...a, overlaps: overlapsByArea.get(a.id) ?? [] }));

  // ---- Assemble + persist --------------------------------------------
  const corpus: CuratedCorpus = {
    version: 3,
    generatedAt: new Date().toISOString(),
    docs: grouped.docs,
    areas,
    relations: autoRelations,
  };
  if (!opts.skipCorpusWrite) {
    // Pass the corpus's own generatedAt so the persisted file equals the returned object.
    writeCorpus(repoRoot, {
      docs: corpus.docs,
      areas: corpus.areas,
      relations: corpus.relations,
      generatedAt: corpus.generatedAt,
    });
  }

  const openOverlaps = areas.flatMap((a) =>
    a.overlaps.map((o) => ({ area: a.id, a: o.docs[0], b: o.docs[1] })),
  );
  const stats: CurateStats = {
    docsScanned: allDocs.length,
    docsKept: docs.length,
    areaCount: areas.length,
    overlapFlags: openOverlaps.length,
    resolvedRelations: relations.length,
    openOverlaps,
    skippedDocs,
  };

  return { corpus, relations, skippedDocs, decisions, stats };
}

// ---------------------------------------------------------------------------
// Decisions I/O — the corpus path reads the SAME decisions.json the claims path
// uses (relations/manualAreas are additive fields); kept here so curate() is
// self-contained. Writes stay the caller's job (CLI / dashboard).
// ---------------------------------------------------------------------------

const EMPTY_DECISIONS: DecisionsFile = {
  version: 1,
  decisions: [],
  manualChains: [],
  manualIncludes: [],
  relations: [],
  manualAreas: [],
};

export function readCorpusDecisions(repoRoot: string): DecisionsFile {
  const file = path.join(repoRoot, '.truecourse', 'specs', 'decisions.json');
  if (!fs.existsSync(file)) return EMPTY_DECISIONS;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return DecisionsFileSchema.parse(raw);
  } catch {
    return EMPTY_DECISIONS;
  }
}
