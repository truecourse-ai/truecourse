/**
 * Persist the extraction stage's claims into the committable claim corpus,
 * `scenarios/claims.json` — the store every claim reference resolves against at
 * load time: a scenario step's `milestone` tag by id, a flow's milestones and
 * `noFlowClaims` by identity (see guard-runner's claim-refs cross-check). A flow
 * naming a claim this store does not hold is a load error on every `guard run`,
 * so the claims a generate mints must land here in the same run that writes the
 * flows naming them.
 *
 * MERGE, never replace: union by claim identity (doc ∷ anchor ∷ title). Every
 * existing claim survives — extraction only runs for changed docs, so the store
 * always holds claims this run never saw (and, on a hand-authored corpus,
 * claims no extraction produced). Nothing is deleted here: pruning a claim
 * safely needs proof nothing references it, which is orphan accounting this
 * stage does not have. No additions ⇒ no write, so an unchanged re-run leaves
 * the file byte-identical.
 *
 * Untestable notes are NOT persisted: the session outcome carries an anchor and
 * a reason but not the statement's verbatim text, which the store's shape
 * requires — and nothing resolves references against the untestable list.
 */

import {
  EMPTY_GUARD_CLAIMS,
  claimContentHash,
  guardClaimKey,
  type ClaimNeed,
  type GuardClaim,
  type GuardClaimsFile,
} from '@truecourse/shared'
import { readGuardClaimsCorpus, slugifyHeading, writeGuardClaims } from '@truecourse/guard-runner'

/** One successfully extracted doc's outcome, as the extraction fold holds it
 *  (anchors already re-snapped against the live section index by the seam). */
export interface ExtractedDocOutcome {
  doc: string
  outcome: {
    claims: readonly { claim: string; sectionAnchor: string; reason: string; needs?: readonly ClaimNeed[] }[]
  }
}

/**
 * The pure merge — exported for {@link persistExtractedClaims} and for tests.
 * `generatedAt` stamps the file only when the union actually grew.
 */
export function mergeExtractedClaims(
  existing: GuardClaimsFile | null,
  extracted: readonly ExtractedDocOutcome[],
  generatedAt: string,
): { file: GuardClaimsFile; added: number } {
  const base = existing ?? EMPTY_GUARD_CLAIMS
  const identities = new Set(base.claims.map(guardClaimKey))
  const usedIds = new Set(base.claims.map((c) => c.id))
  const additions: GuardClaim[] = []
  for (const { doc, outcome } of extracted) {
    for (const c of outcome.claims) {
      // A flow milestone's `claimTitle` is the extraction sentence verbatim
      // (FlowClaimInput.title), so `title` must be that same sentence for the
      // identity the milestone resolves through to exist.
      const candidate = { doc, anchor: c.sectionAnchor, title: c.claim, claim: c.claim }
      const key = guardClaimKey(candidate)
      if (identities.has(key)) continue
      identities.add(key)
      additions.push({
        id: mintClaimId(c.claim, usedIds),
        ...candidate,
        contentHash: claimContentHash(candidate),
        verifyVia: c.reason,
        ...(c.needs && c.needs.length > 0 ? { needs: [...c.needs] } : {}),
      })
    }
  }
  if (additions.length === 0) return { file: base, added: 0 }
  return { file: { ...base, generatedAt, claims: [...base.claims, ...additions] }, added: additions.length }
}

/** Read → merge → write (only when the union grew). Returns how many were added. */
export function persistExtractedClaims(repoRoot: string, extracted: readonly ExtractedDocOutcome[]): number {
  const { file, added } = mergeExtractedClaims(readGuardClaimsCorpus(repoRoot), extracted, new Date().toISOString())
  if (added > 0) writeGuardClaims(repoRoot, file)
  return added
}

/** A stable unique id: the sentence slugified, numbered only on collision. */
function mintClaimId(sentence: string, used: Set<string>): string {
  const base = (slugifyHeading(sentence).slice(0, 80).replace(/-+$/, '') || 'claim').replace(/^-+/, '')
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`
  used.add(id)
  return id
}
