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
// Doc-level relations — the corpus redesign's resolution verbs
// ---------------------------------------------------------------------------

/**
 * The three doc→doc relations the curated-corpus pipeline resolves an
 * overlap into (see docs/SPEC_SCAN_REDESIGN_PLAN.md "three doc-level
 * relations"):
 *
 *   - "replace"    hard supersession — `newer` fully replaces `older`;
 *                  `older` is excluded from generate. Real version chains.
 *   - "precedence" soft / refine — both docs feed generate, `newer` wins
 *                  WHERE THEY OVERLAP, `older`'s unique content survives.
 *   - "keep-both"  peers — both current, combine. This is also the implicit
 *                  default when no relation is recorded, so it is rarely
 *                  stored; an explicit entry pins the intent.
 */
export const RelationTypeSchema = z.enum(['replace', 'precedence', 'keep-both']);
export type RelationType = z.infer<typeof RelationTypeSchema>;

/**
 * A doc→doc relation. May be **area-scoped** so one doc can be
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
 *   - `relations[]`     doc→doc relations (replace/precedence/keep-both)
 *   - `manualAreas[]`   per-doc area-tag overrides
 *   - `manualIncludes[]` relevance-filter force-includes
 *   - `manualExcludes[]` force-excludes (drop an otherwise-kept doc)
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
  /** User-authored doc→doc relations (replace/precedence/keep-both). */
  relations: z.array(RelationSchema).default([]),
  /** User overrides of a doc's auto-assigned area tags. */
  manualAreas: z.array(ManualAreaSchema).default([]),
});
export type DecisionsFile = z.infer<typeof DecisionsFileSchema>;
