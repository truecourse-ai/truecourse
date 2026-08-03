/**
 * Core types for the spec-consolidator engine (corpus path).
 *
 * The engine reads docs (PRDs, ADRs, RFCs, READMEs, design notes,
 * anything markdown), tags each with the AREAS it covers, groups them,
 * flags within-area overlaps, and lets the user resolve overlaps into
 * curation decisions. These types are the shared contracts the corpus
 * stages and the curated `decisions.json` talk through.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status — locked propagation rule
// ---------------------------------------------------------------------------

/**
 * Lifecycle status tag. Travels from spec → IL → verifier so that
 * `planned` / `deferred` / `out-of-scope` operations don't fire
 * `implementation.missing` drifts.
 */
export const StatusSchema = z.enum([
  'shipped',
  'planned',
  'deferred',
  'deprecated',
  'out-of-scope',
]);
export type Status = z.infer<typeof StatusSchema>;

// ---------------------------------------------------------------------------
// Document kinds — signal, not gate
// ---------------------------------------------------------------------------

/**
 * Coarse classification of a source doc. Used as a *signal* that
 * influences prompt variation; never gates which code path runs.
 */
export const DocKindSchema = z.enum([
  'prd',
  'adr',
  'rfc',
  'spec',
  'runbook',
  'design-note',
  'readme',
  // A structural (non-prose) spec source: an OpenAPI / Swagger document. Admitted
  // deterministically by discovery (never through the prose relevance filter);
  // each of its operations becomes a bindable guard section.
  'openapi',
  'unknown',
]);
export type DocKind = z.infer<typeof DocKindSchema>;

/**
 * A SECTION-scoped conflict resolution — the redesign's verdict on ONE
 * disagreement between two specific sections, as opposed to a doc-wide verdict.
 * Keyed by the *dispute identity*: the unordered doc pair plus each side's section
 * anchor and (when the detector captured one) its verbatim disputed-sentence quote.
 * This identity re-matches the same dispute across a rescan even though the corpus's
 * `overlaps[]` are regenerated each scan.
 *
 * The verdict is a claim-level call, never a document-wide one:
 *   - "a"         docA's section is right; docB's disputed claim is stale and is
 *                 SUPPRESSED at extraction (its verbatim sentence yields no claims).
 *   - "b"         docB's section is right; docA's disputed claim is suppressed.
 *   - "dismissed" a detector false-positive — not a real conflict. Resolves the
 *                 gate (visible, reversible) but suppresses NOTHING.
 *
 * `anchorA`/`anchorB` are the conflicting section's heading text (or `null` for a
 * doc's preamble/lead), mirroring {@link OverlapSectionSchema.heading}; `quoteA`/
 * `quoteB` are the verbatim disputed sentence when the detector supplied one.
 */
export const ConflictResolutionSchema = z.object({
  /** Repo-relative path / DocRef of the first doc in the dispute. */
  docA: z.string(),
  /** docA's conflicting section heading, or `null` for its preamble/lead. */
  anchorA: z.string().nullable(),
  /** docA's verbatim disputed sentence, when the detector captured one. */
  quoteA: z.string().optional(),
  /** Repo-relative path / DocRef of the second doc in the dispute. */
  docB: z.string(),
  /** docB's conflicting section heading, or `null` for its preamble/lead. */
  anchorB: z.string().nullable(),
  /** docB's verbatim disputed sentence, when the detector captured one. */
  quoteB: z.string().optional(),
  /** Which side wins, or `dismissed` (not a real conflict). */
  verdict: z.enum(['a', 'b', 'dismissed']),
  /** ISO timestamp the resolution was recorded. */
  resolvedAt: z.string(),
  /** Optional human-readable rationale. */
  note: z.string().optional(),
});
export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

/**
 * A user override of a doc's auto-assigned area tags. Lets the user
 * re-home a mis-tagged doc without re-running the classifier.
 */
export const ManualAreaSchema = z.object({
  /** Repo-relative path / DocRef of the doc. */
  doc: z.string(),
  /** Area ids (`product/concern`) the doc should be tagged with instead. */
  areas: z.array(z.string()),
});
export type ManualArea = z.infer<typeof ManualAreaSchema>;

/**
 * The decisions file — the user-authored curation intent the corpus
 * path reads:
 *
 *   - `manualAreas[]`   per-doc area-tag overrides
 *   - `manualIncludes[]` relevance-filter force-includes
 *   - `manualExcludes[]` force-excludes (drop an otherwise-kept doc)
 *   - `conflictResolutions[]` section-scoped conflict verdicts
 *
 * Unknown fields in an older decisions.json (e.g. a `relations` array from a
 * version that had doc→doc relations) are dropped on parse — nothing consumes
 * them and they are not rewritten.
 */
export const DecisionsFileSchema = z.object({
  version: z.literal(1),
  /**
   * Doc paths the user has manually marked "always include" — these
   * bypass the LLM relevance filter so the user can override a wrong
   * SKIP verdict. Repo-relative paths.
   */
  manualIncludes: z.array(z.string()).default([]),
  /**
   * Doc paths the user has manually marked "always exclude" — force-dropped
   * from the corpus even when the relevance filter would keep them, so the
   * user can remove a doc (and any conflicts it drives). Wins over an include
   * for the same path. Repo-relative paths.
   */
  manualExcludes: z.array(z.string()).default([]),
  /** User overrides of a doc's auto-assigned area tags. */
  manualAreas: z.array(ManualAreaSchema).default([]),
  /**
   * SECTION-scoped conflict verdicts — pick-a-side / dismissal on one flagged
   * disagreement, keyed by dispute identity. Optional with a `[]` default so a
   * decisions.json written before conflict verdicts existed still parses.
   */
  conflictResolutions: z.array(ConflictResolutionSchema).default([]),
});
export type DecisionsFile = z.infer<typeof DecisionsFileSchema>;
