/**
 * The curated-corpus pipeline — `spec scan`'s engine. It curates whole docs
 * into a corpus of areas and overlap flags:
 *
 *   discover → relevance keep/drop → tag each DOC with its AREAS →
 *   group docs by area → flag within-area OVERLAPS →
 *   assemble + persist a CuratedCorpus (corpus.json).
 *
 * Stages: discovery, the relevance filter, and the corpus stages
 * (area-tagger, area-grouper, overlap-detector).
 */

import fs from 'node:fs';
import path from 'node:path';
import { auditTransport, cliTransport, type LlmTransport, type StageTransportTally } from '@truecourse/shared/llm';
import {
  buildCorpusConflicts,
  loadSpecScope,
  orphanedConflictResolutions,
  type CorpusConflict,
} from '@truecourse/shared';
import { discoverDocs, isStructuralSpecDoc, type DocCandidate } from './discovery.js';
import { filterByRelevance, type RelevanceRunner } from './relevance-filter.js';
import {
  resolveRepoIdentity,
  readRepoIdentityInput,
  type RepoIdentity,
} from './repo-identity.js';
import { tagDocs, type AreaTagRunner } from './area-tagger.js';
import { normalizeVocabulary, type VocabRunner } from './vocab-normalizer.js';
import { groupByArea } from './area-grouper.js';
import { flagOverlaps, type OverlapRunner } from './overlap-detector.js';
import { verifyFlaggedOverlaps, type VerifyOverlapRunner } from './overlap-verifier.js';
import { writeCorpus } from './corpus-store.js';
import { writeDecisions } from './orchestrator.js';
import { DecisionsFileSchema, type ConflictResolution, type DecisionsFile } from './types.js';
import { type Area, type CuratedCorpus, type Overlap } from './corpus-types.js';

/** Per-stage model overrides for the curate pipeline. */
export interface CurateModels {
  relevance?: string;
  areaTag?: string;
  vocab?: string;
  overlap?: string;
  verifyOverlap?: string;
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
  /**
   * Who this repository is, for the relevance classifier's IDENTITY block.
   * Omit and curate resolves it from the repo tree. Pass explicit `null` to
   * state that nothing identifies it — EE does, because its scan runs on an
   * ephemeral shallow clone whose directory is named `tc-gate-scan-XXXX`, and
   * resolving there would make that temp name the product's identity.
   */
  repoIdentity?: RepoIdentity | null;
  /** Skip writing `corpus.json`. The corpus is still assembled + returned. */
  skipCorpusWrite?: boolean;

  // --- stage runner overrides + disable flags (tests inject stubs) ----------
  relevanceRunner?: RelevanceRunner;
  disableRelevanceFilter?: boolean;
  areaTagRunner?: AreaTagRunner;
  disableAreaTagging?: boolean;
  vocabRunner?: VocabRunner;
  disableVocabNormalization?: boolean;
  overlapRunner?: OverlapRunner;
  disableOverlapDetection?: boolean;
  verifyOverlapRunner?: VerifyOverlapRunner;

  // --- progress hooks -------------------------------------------------------
  onRelevanceProgress?: (done: number, total: number) => void;
  onTagProgress?: (done: number, total: number) => void;
  onOverlapProgress?: (done: number, total: number) => void;
  onVerifyProgress?: (done: number, total: number) => void;
}

export interface CurateStats {
  docsScanned: number;
  docsKept: number;
  areaCount: number;
  overlapFlags: number;
  /** Flagged overlaps the verify pass pruned as detector false positives (never reach the corpus). */
  overlapRefuted: number;
  /**
   * Conflicts the scan resolved ITSELF by applying a high-confidence verify-pass
   * recommendation (`resolvedBy: 'auto'` in decisions.json — visible, undoable).
   * Surfaced per conflict so the summary can say what was decided, not just count.
   */
  autoResolvedConflicts: Array<{ area: string; a: string; b: string; verdict: 'a' | 'b' | 'dismissed' }>;
  /** Flagged overlaps — refs only; passages + resolved state derived at display. */
  openOverlaps: Array<{ area: string; a: string; b: string }>;
  skippedDocs: Array<{ path: string; reason: string; category?: string }>;
  /**
   * Docs the classifier dropped as belonging to a THIRD-PARTY product. Broken
   * out because an undifferentiated "7 dropped" is what hid F12: on cal.com that
   * number silently contained the repo's entire v2 API reference.
   */
  thirdPartyDropped: number;
  /**
   * Third-party drops the deterministic backstop put back because the doc's
   * prose names our own product. The regression detector for the prompt half of
   * the fix — expected ~0 once the IDENTITY block is doing its job.
   */
  thirdPartyRestored: number;
  /**
   * Relevance calls that FAILED and were kept by the fail-open default. Must
   * be surfaced loudly by every consumer: a broken transport once failed 100%
   * of calls and the corpus looked merely permissive.
   */
  classifyFailed: number;
  /** Active include-scope globs (`spec.include`); empty when discovery looks at everything. */
  scopeGlobs: string[];
  /**
   * Configured manualIncludes that fall outside the active include-scope. A
   * manual include is a relevance-level override, not a universe one, so an
   * out-of-scope include never gets discovered — surfaced here so a scope typo
   * isn't a silent no-op.
   */
  outOfScopeManualIncludes: string[];
  /**
   * Stages that lost LLM calls this run (attempts + failures + the first error).
   * Every stage fails open per item — a failed relevance call keeps its doc, a
   * failed tag call leaves the doc untagged — so without this a partially failed
   * scan is indistinguishable from a clean one. Empty on a clean run; a stage that
   * lost EVERY call never gets here (the run aborts — see {@link curate}).
   */
  llmFailures: StageTransportTally[];
}

export interface CurateResult {
  /** The assembled corpus (whether or not it was written to disk). */
  corpus: CuratedCorpus;
  /** Docs the relevance filter dropped, with reasons. */
  skippedDocs: Array<{ path: string; reason: string; category?: string }>;
  /** The decisions file that informed the run. */
  decisions: DecisionsFile;
  /** Summary counts for CLI output / dashboard status. */
  stats: CurateStats;
}

/**
 * Run the curate pipeline against `repoRoot`.
 *
 * Every LLM stage here fails OPEN per item (a doc whose relevance call fails is
 * kept, a doc whose tag call fails is left untagged) — deliberate, so one bad call
 * can't drop a real spec doc. Total failure is a different thing: a stage that
 * attempted calls and lost EVERY one produced nothing, and its fail-open defaults
 * would be written to `corpus.json` as a healthy result (all docs kept, zero
 * areas). So each stage is checked the moment it ends and the run ABORTS with
 * {@link LlmStageFailureError} before the corpus is assembled or written — the
 * previous corpus stays untouched. Partial failures stay fail-open and are
 * reported in `stats.llmFailures`.
 */
export async function curate(repoRoot: string, opts: CurateOptions = {}): Promise<CurateResult> {
  const decisions = opts.decisions ?? readCorpusDecisions(repoRoot);
  const models = opts.models ?? {};
  const fallbackModel = models.fallback;
  // One counting seam for the whole run: the stages call the wrapped transport, so
  // attempts/failures are accounted centrally rather than at each fail-open site.
  // The default is materialized here (instead of per stage) so an unwrapped
  // transport can't slip past the accounting; it is the same `cliTransport()` each
  // stage would otherwise have built for itself.
  const audit = auditTransport(opts.transport ?? cliTransport());
  const transport = audit.transport;

  // ---- Discover -------------------------------------------------------
  // Include-scope (`spec.include`) narrows the universe to matching markdown
  // before anything else runs. Loaded once so discovery and the out-of-scope
  // manualInclude check below agree. Injected doc sources (EE) carry no scope.
  let allDocs: DocCandidate[];
  let scopeGlobs: string[] = [];
  let outOfScopeManualIncludes: string[] = [];
  if (opts.docSource) {
    allDocs = await opts.docSource();
  } else {
    const scope = loadSpecScope(repoRoot);
    allDocs = discoverDocs(repoRoot, { skipGit: opts.skipGit, scope });
    scopeGlobs = scope.globs;
    if (scope.active) {
      outOfScopeManualIncludes = (decisions.manualIncludes ?? []).filter((p) => !scope.includes(p));
    }
  }

  // Resolve identity AFTER discovery: corpus name-frequency expansion reads the
  // discovered docs. `!== undefined` rather than `??` so an explicit null is
  // honored (see `repoIdentity`).
  const repoIdentity =
    opts.repoIdentity !== undefined
      ? opts.repoIdentity
      : resolveRepoIdentity({ ...readRepoIdentityInput(repoRoot), docs: allDocs });

  // ---- Relevance keep/drop --------------------------------------------
  const relevance = await filterByRelevance(repoRoot, allDocs, {
    identity: repoIdentity,
    runner: opts.relevanceRunner,
    enabled: opts.disableRelevanceFilter !== true,
    manualIncludes: decisions.manualIncludes ?? [],
    transport,
    model: models.relevance,
    fallbackModel,
    onProgress: opts.onRelevanceProgress,
  });
  audit.assertStageHealthy('spec.relevance');
  // Force-excludes drop an otherwise-kept doc from the corpus entirely (not
  // tagged, not grouped, not overlap-checked) so the user can remove a doc and
  // the conflicts it drives. Applied after relevance so it also overrides a
  // force-include for the same path (exclude wins).
  const manualExcludes = new Set(decisions.manualExcludes ?? []);
  const docs = manualExcludes.size
    ? relevance.included.filter((d) => !manualExcludes.has(d.path))
    : relevance.included;
  const skippedDocs = relevance.skipped.map(({ doc, reason, category }) => ({
    path: doc.path,
    reason,
    category,
  }));

  // Structural specs (OpenAPI) are admitted deterministically: they came back
  // INCLUDED from relevance without a call (the filter never classifies them),
  // and they bypass every prose-only stage below (tagging, vocab, overlap). Only
  // prose docs flow through those. The structural docs are appended to the corpus
  // at assembly with empty area tags (`readCorpusAreaTags` degrades to empty).
  const structuralDocs = docs.filter(isStructuralSpecDoc);
  const proseDocs = docs.filter((d) => !isStructuralSpecDoc(d));

  // ---- Tag each doc with its areas ------------------------------------
  const tagsByPath = await tagDocs(repoRoot, proseDocs, {
    runner: opts.areaTagRunner,
    enabled: opts.disableAreaTagging !== true,
    transport,
    model: models.areaTag,
    fallbackModel,
    onProgress: opts.onTagProgress,
  });
  audit.assertStageHealthy('spec.areaTag');

  // ---- Reconcile emergent vocabulary (collapse cross-doc name drift) --
  const vocab = await normalizeVocabulary(repoRoot, tagsByPath, {
    runner: opts.vocabRunner,
    enabled: opts.disableVocabNormalization !== true,
    transport,
    model: models.vocab,
    fallbackModel,
  });
  audit.assertStageHealthy('spec.vocab');

  // ---- Group docs by area ---------------------------------------------
  const grouped = groupByArea(proseDocs, tagsByPath, decisions.manualAreas ?? [], vocab);

  // ---- Flag within-area overlaps --------------------------------------
  const overlapsByArea = await flagOverlaps(repoRoot, grouped.areas, proseDocs, {
    runner: opts.overlapRunner,
    enabled: opts.disableOverlapDetection !== true,
    vocab,
    transport,
    model: models.overlap,
    fallbackModel,
    onProgress: opts.onOverlapProgress,
  });
  audit.assertStageHealthy('spec.overlap');

  // ---- Verify the flagged overlaps (precision pass) -------------------
  // The detector is recall-biased and over-flags; an independent judge re-reads
  // each flag with full context and rules strictly. Only an explicit `refuted`
  // verdict prunes a flag (a detector false positive) — it is dropped here and
  // never reaches the corpus. A confirmed verdict, a verifier error, or a missing
  // verdict all KEEP the flag (fail-open).
  const verified = await verifyFlaggedOverlaps(repoRoot, overlapsByArea, proseDocs, {
    runner: opts.verifyOverlapRunner,
    transport,
    model: models.verifyOverlap,
    fallbackModel,
    onProgress: opts.onVerifyProgress,
  });
  audit.assertStageHealthy('spec.verifyOverlap');
  const areas: Area[] = grouped.areas.map((a) => ({ ...a, overlaps: verified.overlaps.get(a.id) ?? [] }));

  // Structural (OpenAPI) docs join the corpus as valid `CorpusDoc` entries with
  // empty area tags — they were never tagged, but they ARE kept spec sources, so
  // downstream (guard generate/run) indexes each into its operation sections.
  const structuralCorpusDocs = structuralDocs.map((d) => ({
    ref: d.path,
    kind: d.kind,
    lastTouched: d.lastTouched,
    areaTags: [],
  }));

  // ---- Assemble + persist --------------------------------------------
  const corpus: CuratedCorpus = {
    version: 3,
    generatedAt: new Date().toISOString(),
    docs: [...grouped.docs, ...structuralCorpusDocs],
    areas,
    // Persist the dropped docs so the dashboard can surface them (force-include)
    // without re-running the scan. Map the candidate path to a DocRef.
    skippedDocs: skippedDocs.map((s) => ({ ref: s.path, reason: s.reason, category: s.category })),
  };
  let effectiveDecisions = decisions;
  let autoResolvedConflicts: CurateStats['autoResolvedConflicts'] = [];
  if (!opts.skipCorpusWrite) {
    // Pass the corpus's own generatedAt so the persisted file equals the returned object.
    writeCorpus(repoRoot, {
      docs: corpus.docs,
      areas: corpus.areas,
      skippedDocs: corpus.skippedDocs,
      generatedAt: corpus.generatedAt,
    });
    effectiveDecisions = pruneOrphanedConflictResolutions(repoRoot, corpus, decisions);
    const auto = autoApplyHighConfidenceRecommendations(repoRoot, corpus, effectiveDecisions);
    effectiveDecisions = auto.decisions;
    autoResolvedConflicts = auto.applied;
  }

  const openOverlaps = areas.flatMap((a) =>
    a.overlaps.map((o) => ({ area: a.id, a: o.docs[0], b: o.docs[1] })),
  );
  const stats: CurateStats = {
    docsScanned: allDocs.length,
    docsKept: docs.length,
    areaCount: areas.length,
    overlapFlags: openOverlaps.length,
    overlapRefuted: verified.refuted,
    thirdPartyDropped: relevance.skipped.filter((s) => s.category === 'third-party').length +
      relevance.reinstated.length,
    thirdPartyRestored: relevance.reinstated.length,
    classifyFailed: relevance.classifyFailed,
    autoResolvedConflicts,
    openOverlaps,
    skippedDocs,
    scopeGlobs,
    outOfScopeManualIncludes,
    llmFailures: audit.failures(),
  };

  return { corpus, skippedDocs, decisions: effectiveDecisions, stats };
}

/**
 * Drop stored conflict verdicts the freshly written corpus no longer flags a
 * dispute for, in the SAME write cycle the corpus rides — so `decisions.json`
 * never accumulates bookkeeping about disputes that stopped existing (the docs
 * were reconciled, the section moved, the sentence was rewritten).
 *
 * Pruning is safe because a verdict is CHEAPLY RE-DERIVABLE: if the same
 * disagreement re-emerges, the next scan flags it again and the user resolves it
 * again. A rare re-ask is a smaller cost than a permanent pile of stranded
 * verdicts every surface has to explain.
 *
 * "Orphaned" is not decided here: {@link orphanedConflictResolutions} is the ONE
 * live resolved-derivation (the same `buildCorpusConflicts` +
 * `resolutionMatchesConflict` dispute identity the gate, the CLI and the dashboard
 * read), so a verdict is pruned exactly when every surface would have called it
 * stranded. The returned entries are the caller's own array elements, so identity
 * filtering keeps the survivors byte-identical. Writes only when something is
 * actually dropped — an unchanged decisions file is left untouched.
 */
function pruneOrphanedConflictResolutions(
  repoRoot: string,
  corpus: CuratedCorpus,
  decisions: DecisionsFile,
): DecisionsFile {
  const stored = decisions.conflictResolutions ?? [];
  if (stored.length === 0) return decisions;
  const orphans = new Set<unknown>(orphanedConflictResolutions(corpus, decisions));
  if (orphans.size === 0) return decisions;
  const pruned: DecisionsFile = {
    ...decisions,
    conflictResolutions: stored.filter((r) => !orphans.has(r)),
  };
  writeDecisions(repoRoot, pruned);
  return pruned;
}

/**
 * Apply the verify judge's HIGH-confidence recommendations as conflict
 * resolutions, in the same write cycle the corpus rides — so a scan whose judge
 * is sure of a verdict doesn't leave it as homework. Rules:
 *
 *   - only an OPEN conflict (a stored verdict, a dismissal, or a covering
 *     exclude always wins — auto-apply never touches a resolved dispute);
 *   - only `confidence: 'high'` (the judge grades knowing high means unsupervised
 *     application); lower grades stay advisory and surfaces show the grade;
 *   - only an actionable recommendation — pick-a / pick-b / dismiss. A `fix-doc`
 *     is a doc edit only a human can make, so it never auto-applies.
 *
 * Applied entries are ordinary `conflictResolutions[]` rows marked
 * `resolvedBy: 'auto'`, so the gate, extraction suppression, and every surface
 * treat them exactly like a user verdict, and the user can undo or overrule one
 * like any other. An undone auto verdict re-applies on the next scan (the judge's
 * verdict is cached and unchanged) — to make a disagreement stick, record the
 * opposite verdict or dismiss instead of leaving the conflict open.
 */
function autoApplyHighConfidenceRecommendations(
  repoRoot: string,
  corpus: CuratedCorpus,
  decisions: DecisionsFile,
): { decisions: DecisionsFile; applied: CurateStats['autoResolvedConflicts'] } {
  const open = buildCorpusConflicts(corpus, decisions).filter((c) => !c.resolved);
  const applied: CurateStats['autoResolvedConflicts'] = [];
  const added: ConflictResolution[] = [];

  for (const c of open) {
    const review = reviewForConflict(corpus, c);
    const rec = review?.recommendation;
    if (!rec || rec.confidence !== 'high' || rec.action === 'fix-doc') continue;
    const verdict: 'a' | 'b' | 'dismissed' =
      rec.action === 'pick-a' ? 'a' : rec.action === 'pick-b' ? 'b' : 'dismissed';
    const secOf = (doc: string) => (c.sections ?? []).find((s) => s.doc === doc);
    added.push({
      docA: c.a,
      anchorA: secOf(c.a)?.heading ?? null,
      quoteA: secOf(c.a)?.quote,
      docB: c.b,
      anchorB: secOf(c.b)?.heading ?? null,
      quoteB: secOf(c.b)?.quote,
      verdict,
      resolvedAt: new Date().toISOString(),
      note: rec.rationale,
      resolvedBy: 'auto',
    });
    applied.push({ area: c.area, a: c.a, b: c.b, verdict });
  }

  if (added.length === 0) return { decisions, applied };
  const next: DecisionsFile = {
    ...decisions,
    conflictResolutions: [...(decisions.conflictResolutions ?? []), ...added],
  };
  writeDecisions(repoRoot, next);
  return { decisions: next, applied };
}

/**
 * The verify-pass review for a conflict, resolved from its REPRESENTATIVE
 * overlap — the record whose docs order is exactly `[c.a, c.b]` and whose section
 * pointers match — so a `pick-a`/`pick-b` recommendation orients exactly as
 * `c.a`/`c.b`. Mirrors the CLI's lookup (`spec-conflicts.ts`); the merged
 * conflict record deliberately does not carry the review itself.
 */
function reviewForConflict(corpus: CuratedCorpus, c: CorpusConflict): Overlap['review'] {
  const sectionKeys = (
    sections: readonly { doc: string; heading: string | null }[] | undefined,
  ): string[] =>
    (sections ?? [])
      .map((s) => `${s.doc}\x00${s.heading === null || s.heading === undefined ? '\x00lead' : s.heading}`)
      .sort();
  const want = sectionKeys(c.sections);
  const areaIds = [c.area, ...c.areas.filter((a) => a !== c.area)];
  for (const areaId of areaIds) {
    const area = corpus.areas.find((a) => a.id === areaId);
    if (!area) continue;
    for (const ov of area.overlaps) {
      if (ov.docs[0] !== c.a || ov.docs[1] !== c.b) continue;
      const have = sectionKeys(ov.sections);
      if (have.length === want.length && have.every((k, i) => k === want[i]) && ov.review) return ov.review;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Decisions I/O — curate() reads decisions.json for the user's manualAreas and
// include/exclude overrides; kept here so the pipeline is self-contained. The
// only write curate() makes is the orphan prune above; recording new decisions
// stays the caller's job (CLI / dashboard).
// ---------------------------------------------------------------------------

const EMPTY_DECISIONS: DecisionsFile = {
  version: 1,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
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
