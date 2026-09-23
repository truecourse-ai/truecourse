/**
 * What the last extraction of each document said, for the next one to
 * reconcile against (see {@link ExtractPrior}). Read from two places: for a
 * document whose content moved, the outcome the extraction session stored
 * under its PRIOR content hash (the manifest records it per doc) carries every
 * claim in the session's own shape; otherwise — an unchanged document whose
 * own entry missed, a cold or swept cache, a document the manifest never saw —
 * the committed claims store (`scenarios/claims.json`) supplies the document's
 * claims instead, so identity survives without any cache at all.
 *
 * A section is SETTLED when its own text fingerprint is the one the last
 * generate bound (the manifest's flows and gap record carry it) and every prior
 * claim of it can be reused verbatim, which needs the driver the session
 * judged — always known from the cache, and from the store only for rows
 * written since it recorded drivers. A settled section is never re-extracted.
 */

import { readGuardClaimsCorpus } from '@truecourse/guard-runner'
import { guardManifestSections, type GuardManifest, type GuardPrerequisiteTarget } from '@truecourse/shared'
import { docContentHash } from './claim-diff.js'
import { snapExtraction, type ExtractPrior, type PriorClaim, type PriorExtraction, type ReuseExtractionSeam } from './extract.js'
import { flowSectionKey } from './flows.js'
import type { GuardDoc } from './section-plan.js'
import type { UntestableNote } from './schemas.js'

export interface PriorExtractionsInput {
  repoRoot: string
  /** Every document extraction is about to read. */
  docs: readonly GuardDoc[]
  priorManifest: GuardManifest | null
  seam: ReuseExtractionSeam
  prerequisiteTargets?: readonly GuardPrerequisiteTarget[]
  /** Prior extractions another reader (the claim-diff gate) already fetched
   *  from the cache, by document — never fetched twice. */
  cachedPriors?: ReadonlyMap<string, PriorExtraction>
}

/** Per document path, its prior; a document with no prior anywhere is absent. */
export async function priorExtractions(input: PriorExtractionsInput): Promise<Map<string, ExtractPrior>> {
  const out = new Map<string, ExtractPrior>()
  const priorHashes = new Map((input.priorManifest?.docs ?? []).map((d) => [d.doc, d.contentHash]))
  const priorFingerprints = new Map<string, string>()
  for (const view of guardManifestSections(input.priorManifest)) {
    priorFingerprints.set(flowSectionKey(view.doc, view.anchor), view.fingerprint)
  }
  for (const gap of input.priorManifest?.gapSections ?? []) {
    priorFingerprints.set(flowSectionKey(gap.doc, gap.anchor), gap.fingerprint)
  }
  let store: ReturnType<typeof readGuardClaimsCorpus> | undefined

  for (const doc of input.docs) {
    // The cache is asked only for a document whose content MOVED: an unchanged
    // document's own entry is the pool's hit, and when that misses the store
    // is the prior; a document the manifest never recorded has no prior hash
    // to ask under.
    const priorHash = priorHashes.get(doc.doc)
    const moved = priorHash !== undefined && priorHash !== docContentHash(doc.content)
    const cached = moved
      ? (input.cachedPriors?.get(doc.doc) ?? (await input.seam.lookup(doc, priorHash, input.prerequisiteTargets)))
      : null
    let claims: PriorClaim[]
    let untestable: UntestableNote[]
    let fromStore = false
    if (cached) {
      const snapped = snapExtraction(cached, doc.sections)
      claims = snapped.claims
      untestable = snapped.untestable
    } else {
      store ??= readGuardClaimsCorpus(input.repoRoot)
      const rows = (store?.claims ?? []).filter((c) => c.doc === doc.doc)
      if (rows.length === 0) continue
      fromStore = true
      // A store row without a driver rides through the snap as a prior claim
      // that can be briefed but never settled.
      const snapped = snapExtraction<PriorClaim>(
        {
          claims: rows.map((c) => ({
            claim: c.claim,
            ...(c.driver ? { driver: c.driver } : {}),
            ...(c.alternativeDrivers ? { alternativeDrivers: c.alternativeDrivers } : {}),
            ...(c.verification ? { verification: c.verification } : {}),
            sectionAnchor: c.anchor,
            reason: c.verifyVia ?? c.claim,
            ...(c.needs ? { needs: c.needs } : {}),
          })),
          untestable: [],
        },
        doc.sections,
      )
      claims = snapped.claims
      untestable = snapped.untestable
    }

    const byAnchor = new Map<string, PriorClaim[]>()
    for (const c of claims) {
      const list = byAnchor.get(c.sectionAnchor)
      if (list) list.push(c)
      else byAnchor.set(c.sectionAnchor, [c])
    }
    const settledAnchors: string[] = []
    for (const s of doc.sections) {
      if (priorFingerprints.get(flowSectionKey(s.doc, s.anchor)) !== s.fingerprint) continue
      const own = byAnchor.get(s.anchor) ?? []
      // The store carries no untestable notes, so a section it holds no claim
      // for cannot be told apart from one never extracted: it is extracted.
      if (fromStore && own.length === 0) continue
      if (own.some((c) => c.driver === undefined)) continue
      settledAnchors.push(s.anchor)
    }
    out.set(doc.doc, { claims, untestable, settledAnchors })
  }
  return out
}
