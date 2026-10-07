/**
 * The committable claim corpus, `scenarios/claims.json`: the store every claim
 * reference resolves against at load time (a scenario step's `milestone` tag by
 * id, a flow's milestones and `noFlowClaims` by identity, see guard-runner's
 * claim-refs cross-check). It is written WHOLE from the claims the scan read,
 * placed in their live documents: a testable claim is a row, an untestable one
 * an untestable statement with its reason. A flow naming a claim this store
 * does not hold is a load error on every `guard run`, so the file lands in the
 * same run that writes the flows naming it.
 */
import { claimContentHash, type GuardClaim, type GuardClaimsFile, type GuardUntestableStatement } from '@truecourse/shared'
import { writeGuardClaims } from '@truecourse/guard-runner'
import type { PlacedClaim } from './claims-input.js'

/** Write the claim corpus from the placed claims, and return what was written. */
export function writeClaimsCorpus(repoRoot: string, placed: readonly PlacedClaim[], generatedAt: string): GuardClaimsFile {
  const claims: GuardClaim[] = []
  const untestable: GuardUntestableStatement[] = []
  for (const { claim, anchor } of placed) {
    if (claim.testable === true) {
      // A flow milestone's `claimTitle` is the statement verbatim, so `title`
      // is that same sentence for the identity the milestone resolves through.
      const row = { doc: claim.doc, anchor, title: claim.statement, claim: claim.statement }
      claims.push({ id: claim.id, ...row, contentHash: claimContentHash(row) })
    } else {
      untestable.push({ doc: claim.doc, anchor, text: claim.statement, reason: claim.testable.reason })
    }
  }
  const file: GuardClaimsFile = { version: 1, generatedAt, claims, untestable }
  writeGuardClaims(repoRoot, file)
  return file
}
