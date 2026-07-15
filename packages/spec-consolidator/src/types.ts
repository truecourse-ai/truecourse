/**
 * Core types for the spec-consolidator engine (corpus path).
 *
 * The engine reads docs (PRDs, ADRs, RFCs, READMEs, design notes,
 * anything markdown), tags each with the AREAS it covers, groups them,
 * flags within-area overlaps, and lets the user resolve overlaps into
 * doc→doc relations. These types are the shared contracts the corpus
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
  'unknown',
]);
export type DocKind = z.infer<typeof DocKindSchema>;

// ---------------------------------------------------------------------------
// Doc-level relations — LEGACY (retired 2026-07-14, #760)
// ---------------------------------------------------------------------------

/**
 * The three doc→doc relation verbs. LEGACY: relation auto-detection was retired
 * (#760) and nothing in the live pipeline consumes relations anymore. The schema
 * is kept so a `decisions.json` (or pre-#760 corpus) carrying `relations` still
 * parses, and so the deprecated contract-generate path can honor a relation
 * present on an old corpus.
 *
 *   - "replace"    hard supersession — `newer` fully replaces `older`.
 *   - "precedence" soft / refine — `newer` wins where they overlap.
 *   - "keep-both"  peers — both current, combine.
 */
export const RelationTypeSchema = z.enum(['replace', 'precedence', 'keep-both']);
export type RelationType = z.infer<typeof RelationTypeSchema>;

/**
 * A doc→doc relation (legacy). May be **area-scoped** so one doc can be
 * authoritative for one area without burying another.
 */
export const RelationSchema = z.object({
  type: RelationTypeSchema,
  /** Repo-relative path / DocRef of the older / superseded doc. */
  older: z.string(),
  /** Repo-relative path / DocRef of the newer / authoritative doc. */
  newer: z.string(),
  /**
   * Optional area id (`product/concern`) the relation is scoped to. Absent
   * → the relation applies wherever both docs co-occur.
   */
  scope: z.string().optional(),
  /** How the relation surfaced: deterministic filename, an LLM pass, or the user. */
  detectedFrom: z.enum(['filename', 'llm', 'manual']).optional(),
  /** Optional human-readable rationale. */
  note: z.string().optional(),
});
export type Relation = z.infer<typeof RelationSchema>;

/**
 * A SECTION-scoped conflict resolution — the redesign's verdict on ONE
 * disagreement between two specific sections (plan item 31), as opposed to a
 * doc-level {@link RelationSchema} (a legacy, now-inert relation). Keyed by
 * the *dispute identity*: the unordered doc pair plus each side's section anchor
 * and (when the detector captured one) its verbatim disputed-sentence quote. This
 * identity re-matches the same dispute across a rescan even though the corpus's
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
 *   - `conflictResolutions[]` section-scoped conflict verdicts (item 31)
 *   - `relations[]`     LEGACY doc→doc relations (retired #760) — still parsed
 *                       and preserved, but inert (nothing consumes them).
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
  /** LEGACY user-authored doc→doc relations (retired #760) — parsed and preserved, but inert. */
  relations: z.array(RelationSchema).default([]),
  /** User overrides of a doc's auto-assigned area tags. */
  manualAreas: z.array(ManualAreaSchema).default([]),
  /**
   * SECTION-scoped conflict verdicts (plan item 31) — pick-a-side / dismissal on
   * one flagged disagreement, keyed by dispute identity. Optional with a `[]`
   * default so a decisions.json written before item 31 still parses.
   */
  conflictResolutions: z.array(ConflictResolutionSchema).default([]),
});
export type DecisionsFile = z.infer<typeof DecisionsFileSchema>;
