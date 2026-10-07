/**
 * Core types for the spec-consolidator engine (corpus path).
 *
 * The engine reads docs (PRDs, ADRs, RFCs, READMEs, design notes,
 * anything markdown), tags each with the AREAS it covers, groups them,
 * flags the conflicts within each area, and lets the user resolve them into
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
 * A conflict resolution — the verdict on ONE disagreement between two
 * sentences, as opposed to a doc-wide verdict. Keyed by the *conflict
 * identity*: each side's doc and sentence key. This identity re-matches the
 * same conflict across a rescan even though the corpus's `conflicts[]` are
 * regenerated each scan.
 *
 * The verdict is a claim-level call, never a document-wide one:
 *   - "a"         docA's section is right; docB's disputed claim is stale and is
 *                 SUPPRESSED at extraction (its verbatim sentence yields no claims).
 *   - "b"         docB's section is right; docA's disputed claim is suppressed.
 *   - "dismissed" a detector false-positive — not a real conflict. Resolves the
 *                 gate (visible, reversible) but suppresses NOTHING.
 *
 * `anchorA`/`anchorB` are the heading each sentence sat under when the verdict
 * was recorded (or `null` for a doc's preamble/lead) and `quoteA`/`quoteB` its
 * words, both for display; `sentenceA`/`sentenceB` are the sentence keys, the
 * identity.
 */
export const ConflictResolutionSchema = z.object({
  /** Repo-relative path / DocRef of the first doc in the conflict. */
  docA: z.string(),
  /** The heading docA's sentence sat under, or `null` for its preamble/lead. Display only. */
  anchorA: z.string().nullable(),
  /** docA's disputed words, as quoted when the verdict was recorded. Display only. */
  quoteA: z.string().optional(),
  /** docA's sentence key: with the doc, side a's identity. */
  sentenceA: z.string(),
  /** Repo-relative path / DocRef of the second doc in the conflict. */
  docB: z.string(),
  /** The heading docB's sentence sat under, or `null` for its preamble/lead. Display only. */
  anchorB: z.string().nullable(),
  /** docB's disputed words, as quoted when the verdict was recorded. Display only. */
  quoteB: z.string().optional(),
  /** docB's sentence key: with the doc, side b's identity. */
  sentenceB: z.string(),
  /** Which side wins, or `dismissed` (not a real conflict). */
  verdict: z.enum(['a', 'b', 'dismissed']),
  /** ISO timestamp the resolution was recorded. */
  resolvedAt: z.string(),
  /** Optional human-readable rationale. */
  note: z.string().optional(),
  /**
   * Who recorded the verdict. `auto` = the scan applied a high-confidence
   * verify-pass recommendation itself; absent/`user` = a human recorded it.
   * Surfaces badge `auto` entries and they stay undoable like any verdict.
   */
  resolvedBy: z.enum(['user', 'auto']).optional(),
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
 * A SCOPE verdict — the scan orchestrator session's (or the user's) call on one
 * SUBTREE of the doc universe: a directory prefix of repo docs, or a registered
 * llms.txt source (by its id). `exclude` drops the whole subtree BEFORE any
 * discovery-cost stage — its docs never reach identity resolution, the
 * prefilter, or a curation session. `keep` records that the subtree was looked
 * at and belongs, so the orchestrator's covered-universe pre-pass can spend
 * zero sessions on an unchanged universe.
 *
 * `resolvedBy` mirrors {@link ConflictResolutionSchema}: `auto` = the
 * orchestrator session wrote it (replaceable by a later session), absent/`user`
 * = a human wrote it (never overwritten by an auto row).
 */
export const ScopeVerdictSchema = z.object({
  /** Directory prefix of repo docs (`docs/archive`), a single root doc
   *  (`CHANGELOG.md`), `.` for root-level files — or a registered source id. */
  path: z.string(),
  verdict: z.enum(['keep', 'exclude']),
  reason: z.string(),
  /** ISO timestamp the verdict was recorded. */
  decidedAt: z.string(),
  /** `auto` = the orchestrator session; absent/`user` = a human. */
  resolvedBy: z.enum(['user', 'auto']).optional(),
});
export type ScopeVerdict = z.infer<typeof ScopeVerdictSchema>;

/**
 * The decisions file — the user-authored curation intent the corpus
 * path reads:
 *
 *   - `manualAreas[]`   per-doc area-tag overrides
 *   - `manualIncludes[]` relevance-filter force-includes
 *   - `manualExcludes[]` force-excludes (drop an otherwise-kept doc)
 *   - `conflictResolutions[]` conflict verdicts
 *   - `scopeVerdicts[]` subtree keep/exclude calls (see {@link ScopeVerdictSchema})
 *   - `instructions[]`  standing scan instructions — they ride EVERY scan
 *     session's briefing and enter every scan cache key, so editing one
 *     re-scans the corpus (deliberate: an instruction changes every judgment)
 *
 * VERSIONING: version 3 alone parses, and every writer stamps it
 * (`writeDecisions`). Unknown fields are dropped on parse — nothing consumes
 * them and they are not rewritten.
 */
export const DecisionsFileSchema = z.object({
  version: z.literal(3),
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
  /** Conflict verdicts — pick-a-side / dismissal on one conflict, keyed by conflict identity. */
  conflictResolutions: z.array(ConflictResolutionSchema).default([]),
  /**
   * Subtree keep/exclude verdicts over the doc universe. Applied BEFORE
   * discovery-cost stages; user rows are never overwritten by auto rows.
   */
  scopeVerdicts: z.array(ScopeVerdictSchema).default([]),
  /**
   * Standing scan instructions. Briefed to EVERY scan session and folded
   * into every scan cache key — an edit re-scans, which is correct.
   */
  instructions: z.array(z.string()).default([]),
});
export type DecisionsFile = z.infer<typeof DecisionsFileSchema>;

/** The version every writer stamps and the one reader accepts. */
export const DECISIONS_FILE_VERSION = 3 as const;
