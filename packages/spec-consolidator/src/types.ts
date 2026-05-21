/**
 * Core types for the spec-consolidator engine.
 *
 * The engine reads docs (PRDs, ADRs, RFCs, READMEs, design notes,
 * anything markdown), extracts structured `Claim`s about the system,
 * merges them, surfaces `Conflict`s for the user, and writes the
 * canonical spec under `.truecourse/specs/`.
 *
 * These types are the contracts each stage talks through. Locked
 * design choices (see docs/contracts/PLAN.md):
 *
 *   - Topics are a small fixed set (Q1).
 *   - Any difference on the same (topic, subject) is a conflict (Q2).
 *   - Status fields exist at module + operation level (Q6).
 *   - Engine pre-picks defaults; user reviews/overrides (Q7, Q10).
 *   - Custom free-text answers allowed on conflicts (Q11).
 *   - Resolutions persist across re-scans (Q13).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Topics — locked taxonomy (Q1)
// ---------------------------------------------------------------------------

/**
 * The fixed topic set the classifier emits per doc section. Broad on
 * purpose: finer subdivisions (pagination, idempotency, cors, …) are
 * folded into `endpoints` or `data`.
 */
export const TopicSchema = z.enum([
  'auth',
  'endpoints',
  'data',
  'errors',
  'effects',
  'overview',
]);
export type Topic = z.infer<typeof TopicSchema>;

// ---------------------------------------------------------------------------
// Status — locked propagation rule (Q6)
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
 * influences merge-weight priors and prompt variation; never gates
 * which code path runs.
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
// Provenance — every claim carries it
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.object({
  /** Repo-relative path of the source doc. */
  file: z.string(),
  /** 1-based line where the source block starts. */
  line: z.number().int().nonnegative(),
  /** Verbatim quote of the source block — shown to the user during resolution. */
  quote: z.string(),
  /**
   * Additional sources that contributed an identical claim (auto-merge
   * result). Set by the merger when 2+ docs agree on the same fact;
   * absent on singletons. The materializer reads this so module
   * manifests list every source that supports the merged content.
   */
  additionalSources: z
    .array(
      z.object({
        file: z.string(),
        line: z.number().int().nonnegative(),
        quote: z.string(),
      }),
    )
    .optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ---------------------------------------------------------------------------
// Claim — the unit of consolidation
// ---------------------------------------------------------------------------

export const ClaimMetadataSchema = z.object({
  docKind: DocKindSchema,
  status: StatusSchema.optional(),
  /** Detected version label ("v1", "v2", "2026-Q1"); free-form. */
  version: z.string().optional(),
  /** ISO timestamp from `git log` for the source doc. */
  lastTouched: z.string(),
});
export type ClaimMetadata = z.infer<typeof ClaimMetadataSchema>;

/**
 * A single structured assertion extracted from one doc block.
 *
 * `topic + subject` is the merge key — claims sharing both compose
 * (when identical or compatible) or conflict (when different).
 *
 * `content` is topic-specific. The classifier+extractor returns it as
 * loose JSON; downstream stages narrow it via Zod when reading.
 */
/**
 * Whether the source section primarily defines the subject (the
 * authoritative spec for it) or just narrows/constrains a subject
 * defined elsewhere.
 *
 *   - "definition": the section's job is to specify this subject.
 *     Multiple definitions of the same subject that disagree are
 *     real conflicts the user must resolve.
 *   - "constraint": the section is primarily about a different
 *     subject but adds rules to this one (e.g., an "Order ownership"
 *     section that adds auth + 403 to several endpoints). A constraint
 *     is additive — the merger folds it into the matching definition
 *     rather than treating it as a competing alternative.
 */
export const ClaimKindSchema = z.enum(['definition', 'constraint']);
export type ClaimKind = z.infer<typeof ClaimKindSchema>;

export const ClaimSchema = z.object({
  /** Stable id — sha256(file + line + topic + subject). */
  id: z.string(),
  topic: TopicSchema,
  /**
   * The thing being asserted about. Examples:
   *   - "POST /api/auth/wallet"           (an operation)
   *   - "global error envelope"           (a cross-cutting rule)
   *   - "auth scheme"                     (a system-wide choice)
   *   - "Order entity"                    (a data type)
   */
  subject: z.string(),
  /** Topic-specific structured content. */
  content: z.unknown(),
  /**
   * Whether this claim defines the subject or narrows it. Optional —
   * synthetic claims (e.g. version chain candidates) and pre-`kind`
   * test fixtures may omit it; the merger treats absence as
   * "definition", matching the prompt's "when in doubt, prefer
   * definition" rule.
   */
  kind: ClaimKindSchema.optional(),
  provenance: ProvenanceSchema,
  metadata: ClaimMetadataSchema,
});
export type Claim = z.infer<typeof ClaimSchema>;

// ---------------------------------------------------------------------------
// Conflict — emitted by the merger, resolved by the user
// ---------------------------------------------------------------------------

/**
 * A single candidate inside a Conflict. The user picks one (or writes
 * a custom answer per Q11).
 */
export const ConflictCandidateSchema = z.object({
  /** Index into the conflict's candidates array; stable across re-scans. */
  index: z.number().int().nonnegative(),
  /** The claim this candidate represents — provenance + content. */
  claim: ClaimSchema,
  /**
   * Engine-assigned weight class for the default-pick rule (Q10).
   * "newest" wins by default; ties broken arbitrarily but stably.
   */
  weight: z.enum(['newest', 'newer', 'older', 'oldest']),
});
export type ConflictCandidate = z.infer<typeof ConflictCandidateSchema>;

export const ConflictSchema = z.object({
  /** Stable id — sha256(topic + subject + sorted candidate ids). */
  id: z.string(),
  /** Module slug if the conflict is module-scoped; absent for cross-module. */
  module: z.string().optional(),
  topic: TopicSchema,
  subject: z.string(),
  candidates: z.array(ConflictCandidateSchema).min(2),
  /**
   * Engine's pre-picked default (Q7). User accepts it or overrides.
   * Index into `candidates`. Always set when conflict is emitted.
   */
  defaultPick: z.number().int().nonnegative(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

// ---------------------------------------------------------------------------
// Decision — user's resolution, persisted to decisions.json
// ---------------------------------------------------------------------------

/**
 * A user's resolution for a specific conflict id. Either picks one of
 * the existing candidates, or supplies free-text content (Q11).
 *
 * Locked: resolutions persist across re-scans (Q13). The merger looks
 * up by `conflictId` and skips emitting that conflict again as long as
 * the candidates list is unchanged.
 */
export const ResolutionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pick'),
    candidateIndex: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('custom'),
    /** Free-text content the user supplied; treated as authoritative. */
    content: z.string(),
  }),
]);
export type Resolution = z.infer<typeof ResolutionSchema>;

export const DecisionSchema = z.object({
  conflictId: z.string(),
  resolution: ResolutionSchema,
  /** ISO timestamp when the user resolved. */
  resolvedAt: z.string(),
  /** Optional note the user attached. */
  note: z.string().optional(),
  /**
   * The candidate fingerprint at resolution time — sha256 of the sorted
   * candidate ids. If the next scan produces a different fingerprint
   * (e.g. a new candidate appeared), the decision is preserved as-is
   * per Q13 — but the conflict resurfaces as a new id, so the user
   * sees the new state if they care to look.
   */
  candidateFingerprint: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * User-marked version chain — the manual escape hatch when neither the
 * deterministic filename detector nor the LLM detector links two docs
 * that the user knows are versions of each other.
 *
 * Stored alongside conflict decisions in decisions.json so a single
 * file holds everything that survives a re-scan.
 */
export const ManualChainSchema = z.object({
  /** Repo-relative path of the older / superseded doc. */
  older: z.string(),
  /** Repo-relative path of the newer / authoritative doc. */
  newer: z.string(),
  /** ISO timestamp when the user marked the chain. */
  markedAt: z.string(),
  /** Optional human-readable rationale ("v2 explicitly replaces v1"). */
  note: z.string().optional(),
});
export type ManualChain = z.infer<typeof ManualChainSchema>;

export const DecisionsFileSchema = z.object({
  version: z.literal(1),
  decisions: z.array(DecisionSchema),
  /** User-marked supersessions (workstream 2 of conflict-resolution plan). */
  manualChains: z.array(ManualChainSchema).default([]),
});
export type DecisionsFile = z.infer<typeof DecisionsFileSchema>;

// ---------------------------------------------------------------------------
// Module manifest — module.yaml shape
// ---------------------------------------------------------------------------

/**
 * Scope selector — how a spec module claims surface area for the
 * verifier to match against code-side detected modules.
 */
export const ScopeSchema = z.object({
  paths: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});
export type Scope = z.infer<typeof ScopeSchema>;

export const ModuleManifestSchema = z.object({
  name: z.string(),
  status: StatusSchema.default('shipped'),
  description: z.string().optional(),
  /** Repo-relative paths of source docs this module's content came from. */
  sourceDocs: z.array(z.string()),
  scope: ScopeSchema,
  /**
   * Operations the module explicitly excludes (Q6 status chain). Each
   * carries its own provenance back to the doc that excluded it.
   */
  outOfScope: z
    .array(
      z.object({
        id: z.string(),
        reason: z.string().optional(),
        source: z.string(),
      }),
    )
    .optional(),
  /** ISO date — last time the user touched the module's resolutions. */
  lastReviewed: z.string().optional(),
});
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;
