/**
 * Guard CLAIMS, the unit of meaning and of coverage, stored in
 * `.truecourse/scenarios/claims.json` (committable, next to `flows.json`).
 *
 * A claim is ONE testable sentence a spec document states. Its identity is
 * `doc` + `anchor` + `title` (the same triple a dismissal matches on and a flow
 * milestone addresses), and it carries the verbatim claim sentence plus a
 * CONTENT HASH over exactly that identity-and-sentence material, so a doc edit
 * that moves the claim's anchor or rewords its sentence rolls the hash, and an
 * edit anywhere else in the same section does not. That is what makes
 * invalidation precise: only the claims whose own content changed re-author, and
 * only their flows follow.
 *
 * The store also carries the UNTESTABLE list: the behavioral statements
 * extraction looked at and consciously refused, each with its reason. Coverage
 * honesty needs both halves, `flows.json`'s `noFlowClaims` only accounts for
 * claims that EXIST and reached no flow, never for the sentences that never
 * became claims.
 *
 * `id` is a stable handle (a slug of the claim), NOT the identity: it is what a
 * scenario step's milestone tag references, and what a diagnostic names. Two
 * claims may never share one.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import { ClaimNeedSchema } from './extract-outcome'

/**
 * One extracted claim. Identity = `doc` + `anchor` + `title`.
 *
 * A claim is a SENTENCE and its provenance, nothing else. What testing it would
 * take is the dependency catalog's answer (a scenario binds catalog entries by
 * name, and the runner resolves them), and why it was worded this way is the
 * doc's; neither belongs on the claim, where they were a second, staler copy.
 */
export const GuardClaimSchema = z
  .object({
    /** Stable handle, what a scenario step's `milestone` tag references. Unique. */
    id: z.string().min(1),
    /** Repo-relative path of the spec document the claim lives in. */
    doc: z.string().min(1),
    /** Slugified heading path (the section anchor) the claim was extracted under. */
    anchor: z.string().min(1),
    /** The claim's stable short text, the third component of its identity. */
    title: z.string().min(1),
    /** The verbatim testable sentence: what the product must do. */
    claim: z.string().min(1),
    /** `sha256:…` content identity for invalidation, see {@link claimContentHash}. */
    contentHash: z.string().min(1),
    /** How the claim is observed (the falsifiable form), when extraction named one. */
    verifyVia: z.string().min(1).optional(),
    /**
     * What testing this claim requires beyond an empty sandbox (the extraction
     * session's structured `needs`). Advisory grounding for flow synthesis and
     * the dependency catalog, deliberately OUTSIDE {@link claimContentHash}, so
     * a re-extraction that only refines needs never re-authors the claim's flows.
     */
    needs: z.array(ClaimNeedSchema).optional(),
  })
  .strict()
export type GuardClaim = z.infer<typeof GuardClaimSchema>

/**
 * A behavioral statement in a doc that deliberately did NOT become a claim. The
 * honesty half of extraction: what was read and consciously refused, and why.
 * It has no `title` and no id, it is not an object anything can bind to.
 */
export const GuardUntestableStatementSchema = z
  .object({
    doc: z.string().min(1),
    anchor: z.string().min(1),
    /** The statement as the doc words it. */
    text: z.string().min(1),
    /** Why it is not a claim (marketing, internal detail, out-of-scope surface). */
    reason: z.string().min(1),
  })
  .strict()
export type GuardUntestableStatement = z.infer<typeof GuardUntestableStatementSchema>

/** `.truecourse/scenarios/claims.json`, the extracted claim corpus. */
export const GuardClaimsFileSchema = z
  .object({
    version: z.literal(1),
    /** ISO timestamp of the extraction run that wrote the file. */
    generatedAt: z.string(),
    claims: z.array(GuardClaimSchema).default([]),
    /** Statements extraction refused, each with its reason. */
    untestable: z.array(GuardUntestableStatementSchema).default([]),
  })
  .strict()
export type GuardClaimsFile = z.infer<typeof GuardClaimsFileSchema>

/** An empty, valid claims file, the reader's fallback and the writer's seed. */
export const EMPTY_GUARD_CLAIMS: GuardClaimsFile = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  claims: [],
  untestable: [],
}

// --- Identity & content hash -------------------------------------------------

/**
 * THE canonical claim-text normalization: every whitespace run folds to a single
 * space and the ends are trimmed, the same rule the section fingerprint and the
 * flow milestone key use, so re-wrapped prose never moves a claim.
 */
function normalizeClaimText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The identity/material separator, a byte no doc path, anchor or sentence holds. */
const NUL = '\u0000'

/**
 * The stable identity key of a claim: `doc` + `anchor` + `title`, NUL-joined.
 * `dismissedClaimKey` delegates to it, so a decision taken against a claim and the
 * claim itself can never key differently.
 */
export function claimIdentityKey(doc: string, anchor: string, title: string): string {
  return `${doc}${NUL}${anchor}${NUL}${title}`
}

/** {@link claimIdentityKey} over a claim-shaped object. */
export function guardClaimKey(claim: Pick<GuardClaim, 'doc' | 'anchor' | 'title'>): string {
  return claimIdentityKey(claim.doc, claim.anchor, claim.title)
}

/**
 * `sha256:<hex>` over the claim's INVALIDATION MATERIAL: its doc, its anchor, its
 * title and its sentence, each normalized. Deliberately NOT the section
 * fingerprint, hashing the whole section would roll every claim in it whenever
 * one sibling paragraph changed, which is exactly the over-invalidation precise
 * incrementality exists to avoid. A doc edit that reworded this claim, moved it
 * to another section, or retitled it rolls the hash; an edit anywhere else does
 * not.
 */
export function claimContentHash(
  claim: Pick<GuardClaim, 'doc' | 'anchor' | 'title' | 'claim'>,
): string {
  const material = [claim.doc, claim.anchor, claim.title, claim.claim]
    .map(normalizeClaimText)
    .join(NUL)
  return `sha256:${crypto.createHash('sha256').update(material, 'utf-8').digest('hex')}`
}

/** True when the claim's stored `contentHash` still matches its content. */
export function isClaimContentCurrent(claim: GuardClaim): boolean {
  return claim.contentHash === claimContentHash(claim)
}

// --- Lookups -----------------------------------------------------------------

/** Claim id → claim. Later duplicates lose (the loader reports them separately). */
export function claimsById(claims: readonly GuardClaim[]): Map<string, GuardClaim> {
  const out = new Map<string, GuardClaim>()
  for (const c of claims) if (!out.has(c.id)) out.set(c.id, c)
  return out
}

/** {@link claimIdentityKey} → claim. The index a flow milestone resolves through. */
export function claimsByIdentity(claims: readonly GuardClaim[]): Map<string, GuardClaim> {
  const out = new Map<string, GuardClaim>()
  for (const c of claims) {
    const key = guardClaimKey(c)
    if (!out.has(key)) out.set(key, c)
  }
  return out
}
