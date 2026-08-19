/**
 * Claim extraction — the engine half of the `guard-generate.extract` SESSION
 * (plan 04 step 15; the per-view one-shot engine was retired by step 20). One
 * agent session per document pages the doc itself and returns its testable
 * claims plus per-section untestable notes; the session implementation lives in
 * `@truecourse/core` (this package cannot depend on it) and is injected through
 * {@link ExtractSessionSeam}.
 *
 * What stays HERE is everything deterministic the fold must never trust the
 * model for: {@link snapExtraction} snaps every returned anchor against the
 * live section index — the session's `check_claims` tool runs it live, and the
 * seam's fold re-runs it on the outcome, so a model-authored anchor is never
 * trusted whichever path produced it.
 *
 * The retired one-shot's per-view cache (`.cache/guard/extract`) is ORPHANED:
 * its files remain on disk (derived, deletable) but nothing reads or writes
 * them any more — the session path caches per doc under `guard/extract-session`
 * (see `@truecourse/core`'s `services/guard-generate/extract.ts`).
 */

import { slugifyHeading } from '@truecourse/guard-runner'
import { type ClaimNeed } from '@truecourse/shared'
import { type ExtractedClaim, type UntestableNote } from './schemas.js'
import type { GuardDoc, SectionInput } from './section-plan.js'

/**
 * One extracted claim, carrying the extraction SESSION's structured `needs` —
 * what testing it takes beyond an empty sandbox. The session always stamps the
 * array (empty when a claim needs nothing); downstream consumers treat absence
 * and emptiness alike.
 */
export type ExtractedClaimWithNeeds = ExtractedClaim & { needs?: ClaimNeed[] }

/** A document's snapped extraction: claims + notes both bound to live anchors. */
export interface DocClaims {
  claims: ExtractedClaimWithNeeds[]
  untestable: UntestableNote[]
}

/**
 * A document's extraction outcome. On the session path a doc is one session:
 * `complete` is always true on success and `failedViews` 0 (the fields survive
 * from the per-view era so the consumer's shape is unchanged). `ok: false` is a
 * failed (or missing) session for the doc — fail-open, reported, re-attempted
 * next run.
 */
export type ExtractResult =
  | { ok: true; data: DocClaims; complete: boolean; failedViews: number }
  | { ok: false; reason: string }

// ---------------------------------------------------------------------------
// The extraction SESSION seam (plan 04 step 15) — typed here because the engine
// cannot depend on `@truecourse/core`, which owns the sessions; the command
// adapter injects the implementation. Mirrors the guard-setup seams (plan 03).
// ---------------------------------------------------------------------------

/**
 * What one session-kind pool did — the session analog of a transport tally
 * (sessions, not calls). `allTransport` distinguishes "the provider was down"
 * (systemic ⇒ the run aborts before writing) from "a session went malformed /
 * over budget" (fail-open per doc, tallied).
 */
export interface GuardSessionSummary {
  /** The session kind that ran (`guard-generate.extract`, `guard-generate.flows`). */
  kind: string
  /** Sessions that actually ran (cache hits never do). */
  ran: number
  fromCache: number
  failed: number
  /** True when every failure was transport-class (vacuously true at 0 failures). */
  allTransport: boolean
  firstError?: string
  spent: { turns: number; tokens: number; costUsd: number }
}

/** A summary that means: sessions were attempted and the provider lost every one. */
export function isSystemicSessionLoss(s: GuardSessionSummary): boolean {
  return s.ran > 0 && s.failed === s.ran && s.allTransport
}

/**
 * The claim-extraction session seam: one `guard-generate.extract` agent session
 * per document (cache-aware — an unchanged doc spends nothing). The
 * implementation (in `@truecourse/core`) pools the sessions, re-snaps every
 * anchor in its fold, and returns per-doc results as {@link ExtractResult},
 * claims carrying the session's `needs`. Fail-open per doc: a failed session is
 * an `ok: false` entry, never a throw.
 */
export type ExtractSessionSeam = (input: {
  docs: readonly GuardDoc[]
  /** Ticks once per settled doc (cache hits included). */
  onDoc?: (done: number, total: number) => void
}) => Promise<{ byDoc: Map<string, ExtractResult>; summary: GuardSessionSummary }>

// ---------------------------------------------------------------------------
// Anchor snapping + dedupe
// ---------------------------------------------------------------------------

/** Re-slugify a possibly-loose anchor path segment-by-segment. */
function reslug(anchor: string): string {
  return anchor
    .split('/')
    .filter(Boolean)
    .map((seg) => slugifyHeading(seg))
    .filter(Boolean)
    .join('/')
}

/**
 * Snap model-returned anchors onto the live section index and drop the rest.
 * Precedence: exact anchor; re-slugified path; unique leaf-segment match. A claim
 * whose anchor snaps to nothing is dropped (its section then shows as a coverage
 * gap — honest) rather than bound to the wrong place.
 *
 * Exported (generic over the claim shape, so a session claim's `needs` survive
 * the snap) because the `guard-generate.extract` session uses it twice: the
 * `check_claims` tool runs it LIVE so a fabricated anchor bounces in-session,
 * and the seam's fold re-runs it on the outcome — model anchors are never
 * trusted, whichever path produced them.
 */
export function snapExtraction<C extends ExtractedClaim>(
  raw: { claims: C[]; untestable: UntestableNote[] },
  sections: SectionInput[],
): { claims: C[]; untestable: UntestableNote[] } {
  const valid = new Set(sections.map((s) => s.anchor))
  const bySlug = new Map<string, string>()
  const byLeaf = new Map<string, string[]>()
  for (const s of sections) {
    bySlug.set(reslug(s.anchor), s.anchor)
    const leaf = slugifyHeading(s.anchor.split('/').filter(Boolean).pop() ?? s.anchor)
    const list = byLeaf.get(leaf)
    if (list) list.push(s.anchor)
    else byLeaf.set(leaf, [s.anchor])
  }

  const snapAnchor = (rawAnchor: string): string | null => {
    if (valid.has(rawAnchor)) return rawAnchor
    const rs = reslug(rawAnchor)
    if (bySlug.has(rs)) return bySlug.get(rs)!
    const leaf = slugifyHeading(rawAnchor.split('/').filter(Boolean).pop() ?? rawAnchor)
    const cands = byLeaf.get(leaf)
    return cands && cands.length === 1 ? cands[0] : null
  }

  const claims: C[] = []
  const seenClaim = new Set<string>()
  for (const c of raw.claims) {
    const anchor = snapAnchor(c.sectionAnchor)
    if (!anchor) continue
    const key = `${anchor}\0${c.driver}\0${c.claim.replace(/\s+/g, ' ').trim().toLowerCase()}`
    if (seenClaim.has(key)) continue
    seenClaim.add(key)
    claims.push({ ...c, sectionAnchor: anchor })
  }

  const untestable: UntestableNote[] = []
  const seenNote = new Set<string>()
  for (const n of raw.untestable) {
    const anchor = snapAnchor(n.sectionAnchor)
    if (!anchor || seenNote.has(anchor)) continue
    seenNote.add(anchor)
    untestable.push({ ...n, sectionAnchor: anchor })
  }

  return { claims, untestable }
}
