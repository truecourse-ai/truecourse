/**
 * The committable claim corpus, `scenarios/claims.json`: the store every claim
 * reference resolves against at load time (a scenario step's `milestone` tag, a
 * flow's milestones and `noFlowClaims`, all by claim id — see guard-runner's
 * claim-refs cross-check). It is written WHOLE from the claims the scan read
 * for this repository's documents that the live documents still hold, testable
 * and untestable alike, so coverage can list every one. A flow naming a claim
 * this store does not hold is a load error on every `guard run`, so the file
 * lands in the same run that writes the flows naming it.
 */
import { CLAIMS_FILE_VERSION, type Claim, type ClaimsFile } from '@truecourse/shared'
import { writeGuardClaims } from '@truecourse/guard-runner'

/** Write the claim corpus from the live claims, and return what was written. */
export function writeClaimsCorpus(repoRoot: string, claims: readonly Claim[], generatedAt: string): ClaimsFile {
  const file: ClaimsFile = { version: CLAIMS_FILE_VERSION, generatedAt, claims: [...claims] }
  writeGuardClaims(repoRoot, file)
  return file
}
