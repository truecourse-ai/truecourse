/**
 * The guard decisions file — user-authored curation intent that `guard generate`
 * reads, the guard analogue of the spec-consolidator's `specs/decisions.json`.
 *
 * It lives at `.truecourse/scenarios/decisions.json`, next to `recipe.json` and
 * `manifest.json` (the committable scenario-binding files) — NOT under the mostly
 * gitignored `guard/` run store. It is committable and MUST travel with the repo:
 * a teammate who clones and re-runs generate inherits your dismissals, so a claim
 * you judged noise stays dismissed for everyone.
 *
 * Today it holds only `dismissedClaims`: findings the user judged a generation
 * defect / won't-fix / noise. A dismissed claim (identity = its section anchor +
 * the extracted claim's stable text) is skipped by generate — never re-authored,
 * never re-findinged — and settles as an explicit `dismissed` coverage gap. Undo
 * by removing its entry (the UI's Un-dismiss, or by hand).
 */

import { z } from 'zod'

/**
 * One dismissed claim. Identity is `anchor` + `title` (the extracted claim's
 * stable text); `doc` scopes the anchor to its document and drives display. Not
 * `.strict()` so a future field never breaks an old reader (mirrors the spec
 * decisions file).
 */
export const GuardDismissedClaimSchema = z.object({
  /** Repo-relative doc path the claim's section lives in. */
  doc: z.string().min(1),
  /** The section anchor (slug) the claim was extracted under. */
  anchor: z.string().min(1),
  /** The extracted claim's stable text — the identity, with `anchor`. */
  title: z.string().min(1),
  /** ISO timestamp the dismissal was recorded. */
  dismissedAt: z.string(),
  /** Optional free-text rationale ("flaky", "won't fix", …). */
  note: z.string().optional(),
})
export type GuardDismissedClaim = z.infer<typeof GuardDismissedClaimSchema>

/** Just the identity fields a dismissal keys on (doc + anchor + title) — what the
 *  dismiss/undismiss surfaces pass around; `dismissedClaimKey` hashes the same trio. */
export type GuardClaimIdentity = Pick<GuardDismissedClaim, 'doc' | 'anchor' | 'title'>

/**
 * One dismissed FINDING — the per-finding sibling of the legacy claim entry.
 * Identity is `doc + anchor + scenarioHash` (the behavior hash, see
 * `scenarioHashFromYaml`): a judgment on a TEST, not on which reviewer flagged it
 * — birth and fidelity findings share the same identity and suppression, so the
 * entry carries no `kind`. Not `.strict()` (mirrors the claim entry).
 */
export const GuardDismissedFindingSchema = z.object({
  /** Repo-relative doc path the finding's section lives in. */
  doc: z.string().min(1),
  /** The section anchor (slug) the finding was recorded under. */
  anchor: z.string().min(1),
  /** The behavior hash of the dismissed candidate (`scenarioHashFromYaml`). */
  scenarioHash: z.string().min(1),
  /**
   * The dismissed candidate's serialized YAML — the SERVER's copy of the served
   * finding, stored VERBATIM (incl. injected id/binds/guard). Detail display plus
   * the comparison anchor for a future equivalence layer. NEVER treat as the
   * current scenario (it may be stale); features that need the live scenario must
   * read the scenario tree, not this copy.
   */
  yaml: z.string(),
  /** The scenario title — display only, not identity. */
  title: z.string(),
  /** The extracted claim's text — display only, OPTIONAL (claim-less findings are
   *  dismissible). Named honestly: `claim` holds claim text, unlike the legacy
   *  entry's `title`. */
  claim: z.string().optional(),
  /** ISO timestamp the dismissal was recorded. */
  dismissedAt: z.string(),
  /** Optional free-text rationale — length-capped at the route. */
  note: z.string().optional(),
})
export type GuardDismissedFinding = z.infer<typeof GuardDismissedFindingSchema>

/** Just the identity fields a per-finding dismissal keys on — what the new
 *  dismiss/undismiss surfaces pass around; `guardFindingKey` joins the same trio. */
export type GuardFindingIdentity = Pick<GuardDismissedFinding, 'doc' | 'anchor' | 'scenarioHash'>

/** The whole decisions file. `dismissedClaims` defaults to `[]` so a partial or
 *  freshly-created file still parses. `.passthrough()` is load-bearing: every
 *  mutator is a read-modify-write that persists the PARSED object, so a reader
 *  older than a field (e.g. a future dismissal array) must carry the unknown key
 *  through to disk, never strip it — a plain (non-strict) object still strips. */
export const GuardDecisionsSchema = z
  .object({
    version: z.literal(1),
    dismissedClaims: z.array(GuardDismissedClaimSchema).default([]),
    dismissedFindings: z.array(GuardDismissedFindingSchema).default([]),
  })
  .passthrough()
export type GuardDecisions = z.infer<typeof GuardDecisionsSchema>

/** An empty, valid decisions file — the reader's fallback and the writer's seed. */
export const EMPTY_GUARD_DECISIONS: GuardDecisions = {
  version: 1,
  dismissedClaims: [],
  dismissedFindings: [],
}

/** Hard length cap for a dismissal `note` — it persists into a git-committed
 *  file. Both dismiss routes (claim and finding) reject an oversize note with a
 *  400 rather than truncating silently. */
export const GUARD_DISMISS_NOTE_MAX = 2000

/** The stable identity key a dismissal / claim matches on: doc + anchor + title. */
export function dismissedClaimKey(doc: string, anchor: string, title: string): string {
  return `${doc}\0${anchor}\0${title}`
}

/** The stable identity key a per-finding dismissal matches on: doc + anchor +
 *  the behavior hash (`scenarioHashFromYaml`) — the `dismissedClaimKey`
 *  convention, NUL-delimited. One derivation helper shared by server and client:
 *  the client compares keys it RECEIVED, it never re-derives identity. */
export function guardFindingKey(doc: string, anchor: string, scenarioHash: string): string {
  return `${doc}\0${anchor}\0${scenarioHash}`
}

/** Split a served `findingKey` back into its identity — the inverse of
 *  {@link guardFindingKey}, so no consumer (the client's dismiss payload) has to
 *  know the string's internal layout. `null` for a malformed key. */
export function parseGuardFindingKey(key: string): GuardFindingIdentity | null {
  const [doc, anchor, scenarioHash] = key.split('\0')
  return doc && anchor && scenarioHash ? { doc, anchor, scenarioHash } : null
}
