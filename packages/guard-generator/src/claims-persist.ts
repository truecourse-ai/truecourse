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
 * The one move that is not an addition: a claim that REPLACES a prior one (the
 * re-extraction reworded the sentence and said so) takes the prior row over —
 * same `id`, so every scenario milestone tag naming it still resolves — with
 * the new identity and a fresh content hash. A row is never left behind for a
 * sentence the document no longer states that way.
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
  type GuardVerification,
  type GuardClaimsFile,
} from '@truecourse/shared'
import { readGuardClaimsCorpus, slugifyHeading, writeGuardClaims } from '@truecourse/guard-runner'

/** One successfully extracted doc's outcome, as the extraction fold holds it
 *  (anchors already re-snapped against the live section index by the seam). */
export interface ExtractedDocOutcome {
  doc: string
  outcome: {
    claims: readonly {
      claim: string
      sectionAnchor: string
      reason: string
      driver?: GuardClaim['driver']
      alternativeDrivers?: GuardClaim['alternativeDrivers']
      verification?: GuardVerification
      needs?: readonly ClaimNeed[]
      /** The prior sentence this claim supersedes — its row is taken over. */
      replaces?: string
    }[]
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
): { file: GuardClaimsFile; added: number; updated: number; replaced: number } {
  const base = existing ?? EMPTY_GUARD_CLAIMS
  const claims = base.claims.map(c => ({ ...c }))
  let updated = 0
  let replaced = 0
  const identities = new Set(base.claims.map(guardClaimKey))
  const usedIds = new Set(base.claims.map((c) => c.id))
  const additions: GuardClaim[] = []
  /** The row-level metadata an outcome refreshes on a row it keeps or takes over. */
  const refresh = (row: GuardClaim, c: ExtractedDocOutcome['outcome']['claims'][number]): boolean => {
    const before = JSON.stringify([row.needs ?? [], row.verification, row.driver, row.alternativeDrivers])
    row.needs = [...(c.needs ?? [])]
    row.verification = c.verification
    if (c.driver) row.driver = c.driver
    if (c.alternativeDrivers) row.alternativeDrivers = [...c.alternativeDrivers]
    else if (c.driver) delete row.alternativeDrivers
    if (row.needs.length === 0) delete row.needs
    if (row.verification === undefined) delete row.verification
    return JSON.stringify([row.needs ?? [], row.verification, row.driver, row.alternativeDrivers]) !== before
  }
  for (const { doc, outcome } of extracted) {
    for (const c of outcome.claims) {
      // A flow milestone's `claimTitle` is the extraction sentence verbatim
      // (FlowClaimInput.title), so `title` must be that same sentence for the
      // identity the milestone resolves through to exist.
      const candidate = { doc, anchor: c.sectionAnchor, title: c.claim, claim: c.claim }
      const key = guardClaimKey(candidate)
      if (identities.has(key)) {
        const prior = claims.find(row => guardClaimKey(row) === key)
        if (prior && refresh(prior, c)) updated++
        continue
      }
      // The reworded sentence takes its prior row over: the prior row is looked
      // up in the same section first, then anywhere in the document (the
      // sentence may have moved under another heading).
      const superseded = c.replaces === undefined ? undefined
        : claims.find(row => row.doc === doc && row.anchor === c.sectionAnchor && row.title === c.replaces)
          ?? claims.find(row => row.doc === doc && row.title === c.replaces)
      if (superseded) {
        identities.delete(guardClaimKey(superseded))
        identities.add(key)
        superseded.anchor = candidate.anchor
        superseded.title = candidate.title
        superseded.claim = candidate.claim
        superseded.contentHash = claimContentHash(candidate)
        superseded.verifyVia = c.reason
        refresh(superseded, c)
        replaced++
        continue
      }
      identities.add(key)
      additions.push({
        id: mintClaimId(c.claim, usedIds),
        ...candidate,
        contentHash: claimContentHash(candidate),
        verifyVia: c.reason,
        ...(c.verification ? { verification: c.verification } : {}),
        ...(c.needs && c.needs.length > 0 ? { needs: [...c.needs] } : {}),
        ...(c.driver ? { driver: c.driver } : {}),
        ...(c.alternativeDrivers && c.alternativeDrivers.length > 0 ? { alternativeDrivers: [...c.alternativeDrivers] } : {}),
      })
    }
  }
  if (additions.length === 0 && updated === 0 && replaced === 0) return { file: base, added: 0, updated: 0, replaced: 0 }
  return { file: { ...base, generatedAt, claims: [...claims, ...additions] }, added: additions.length, updated, replaced }
}

/** Read → merge → write (only when the union grew). Returns how many were added. */
export function persistExtractedClaims(repoRoot: string, extracted: readonly ExtractedDocOutcome[]): number {
  const { file, added, updated, replaced } = mergeExtractedClaims(readGuardClaimsCorpus(repoRoot), extracted, new Date().toISOString())
  if (added > 0 || updated > 0 || replaced > 0) writeGuardClaims(repoRoot, file)
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
