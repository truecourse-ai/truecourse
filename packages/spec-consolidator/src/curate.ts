/**
 * The deterministic TAIL of the curate pipeline, and the result shapes every
 * scan surface reads.
 *
 * The `curate()` orchestration itself retired with the spec-scan SESSIONS:
 * the run now lives in `@truecourse/core`'s
 * `services/spec-scan/run.ts`, one agent session per doc (curation), at most
 * one per corpus (area settling) and one per area (overlap) — replacing the
 * five one-shot LLM stages this module used to chain. What stays here is the
 * part that was never a call and that the new run folds through unchanged:
 *
 * - {@link CurateStats} / {@link CurateResult} — the CLI and dashboard read
 *   exactly these fields off a scan, whichever engine produced it;
 * - {@link readCorpusDecisions} — the decisions read the run curates with;
 * - {@link pruneOrphanedConflictResolutions} — drop stored verdicts whose docs
 *   left the corpus, in the same write cycle the corpus rides;
 * - {@link autoApplyHighConfidenceRecommendations} — apply the session judge's
 *   high-confidence recommendations as `resolvedBy: 'auto'` verdicts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { type StageTransportTally } from '@truecourse/shared/llm';
import {
  buildCorpusConflicts,
  type CorpusConflict,
} from '@truecourse/shared';
import { writeDecisions } from './orchestrator.js';
import {
  DECISIONS_FILE_VERSION,
  DecisionsFileSchema,
  type ConflictResolution,
  type DecisionsFile,
} from './types.js';
import { type CuratedCorpus, type Overlap } from './corpus-types.js';

export interface CurateStats {
  docsScanned: number;
  docsKept: number;
  areaCount: number;
  overlapFlags: number;
  /**
   * Flagged overlaps a verify pass pruned as detector false positives. Always 0
   * on a session scan — the overlap session flags and adjudicates in ONE pass,
   * so there is no recall-biased detector to prune behind. Kept in the shape so
   * older engines' results still parse and the CLI line renders either way.
   */
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
   * Curation SESSIONS that FAILED and whose docs were kept by the fail-open
   * default. Must be surfaced loudly by every consumer: a broken transport once
   * failed 100% of calls and the corpus looked merely permissive.
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
   * Session kinds that lost SESSIONS this run (attempts + failures + the first
   * error), in the same tally shape the one-shot stages used — `attempts` counts
   * the sessions that actually ran (cache hits never do), `failures` the ones
   * that never reached an outcome. Every kind fails open per item, so without
   * this a partially failed scan is indistinguishable from a clean one. Empty on
   * a clean run; a kind that lost EVERY session never gets here (the run aborts
   * with `LlmStageFailureError` before anything is written).
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
 * Drop stored conflict verdicts whose DOCS left the corpus, in the SAME write
 * cycle the corpus rides. That is the only staleness this prune acts on: a
 * resolution naming a doc the corpus no longer holds cannot ever match a
 * flagged dispute again, so dropping it is deterministic and safe.
 *
 * A resolution that merely matches no CURRENT overlap flag is KEPT, dormant.
 * This function used to prune those too, on the premise that a verdict is
 * cheaply re-derivable — the next scan would flag the same dispute and the user
 * would resolve it again. The 2026-08-20 reference-corpus runs falsified that:
 * the overlap session is a stochastic judge (~50–60% pair recall run-to-run),
 * and when it DOES re-flag a pair it excerpts the quotes differently (drifted
 * quotes on 6 of 6 re-flagged pairs), so `resolutionMatchesConflict`'s
 * quote-keyed identity orphaned 16 of 20 code-verified user verdicts in one
 * scan — and deleted them. Dormant rows instead stay in `decisions.json`
 * (surfaced by `orphanedConflictResolutions` and offered as reapply hints on
 * re-flagged pairs via `dormantResolutionForPair`).
 *
 * The returned entries are the caller's own array elements, so identity
 * filtering keeps the survivors byte-identical. Writes only when something is
 * actually dropped — an unchanged decisions file is left untouched.
 */
export function pruneOrphanedConflictResolutions(
  repoRoot: string,
  corpus: CuratedCorpus,
  decisions: DecisionsFile,
): DecisionsFile {
  const stored = decisions.conflictResolutions ?? [];
  if (stored.length === 0) return decisions;
  const docs = new Set(corpus.docs.map((d) => d.ref));
  const kept = stored.filter((r) => docs.has(r.docA) && docs.has(r.docB));
  if (kept.length === stored.length) return decisions;
  const pruned: DecisionsFile = { ...decisions, conflictResolutions: kept };
  writeDecisions(repoRoot, pruned);
  return pruned;
}

/**
 * Apply the judge's HIGH-confidence recommendations as conflict resolutions, in
 * the same write cycle the corpus rides — so a scan whose judge is sure of a
 * verdict doesn't leave it as homework. Rules:
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
export function autoApplyHighConfidenceRecommendations(
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
 * The judge's review for a conflict, resolved from its REPRESENTATIVE
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
// Decisions I/O — the scan run reads decisions.json for the user's manualAreas
// and include/exclude overrides; kept here so the deterministic tail is
// self-contained. Recording new decisions stays the caller's job (CLI /
// dashboard); the only writes this module makes are the prune + auto-apply
// above.
// ---------------------------------------------------------------------------

const EMPTY_DECISIONS: DecisionsFile = {
  version: DECISIONS_FILE_VERSION,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
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
