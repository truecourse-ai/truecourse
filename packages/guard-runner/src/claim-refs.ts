/**
 * The claim-reference cross-check: every reference into the claims store, from
 * every layer that makes one, resolved at LOAD TIME.
 *
 * Three layers reference claims, and each addresses them differently:
 *
 *  - a scenario step's `milestone` tag, by claim ID (`analyze-runs-…`);
 *  - a flow's milestones, by claim IDENTITY (`doc` + `anchor` + `claimTitle`);
 *  - a flow corpus's `noFlowClaims`, by the same identity.
 *
 * A reference that resolves to nothing is a corpus defect: coverage accounting is
 * claim-keyed, so a dangling reference silently removes a claim from the
 * denominator and a milestone from the trace. It reports through the SAME
 * `ScenarioLoadError` channel a malformed scenario file does — loud at load,
 * never a run-time surprise — and it never drops the referencing object: the
 * scenario still runs and the flow still renders, with the defect named.
 *
 * A repository with no claims store is not a defect. It has simply never
 * extracted claims, so there is nothing to resolve against and the check is a
 * no-op — the same fail-soft rule every derived-store reader follows.
 */

import { guardClaimKey, guardExecutionSteps, milestoneClaims, type GuardClaimsFile, type GuardFlowsFile, type GuardScenario } from '@truecourse/shared'
import type { ScenarioLoadError } from './scenario-loader.js'

/** Repo-relative path of the flow corpus, for load-error attribution. */
const FLOWS_REL = '.truecourse/scenarios/flows.json'
/** Repo-relative path of the claim corpus, for load-error attribution. */
const CLAIMS_REL = '.truecourse/scenarios/claims.json'

/** Everything the cross-check reads. A `null` claims store makes it a no-op. */
export interface ClaimRefSources {
  claims: GuardClaimsFile | null
  flows: GuardFlowsFile | null
  /** Loaded scenarios, each with the repo-relative file it came from. */
  scenarios: ReadonlyArray<{ scenario: GuardScenario; file: string }>
}

/**
 * Resolve every claim reference in `sources` against the claims store, returning
 * one load error per dangling reference (and per duplicate claim id, which would
 * make a milestone tag ambiguous). Pure — the caller does the reading.
 */
export function crossCheckClaimRefs(sources: ClaimRefSources): ScenarioLoadError[] {
  const { claims, flows, scenarios } = sources
  if (!claims) return []

  const errors: ScenarioLoadError[] = []

  // A duplicated id makes every milestone tag naming it ambiguous, so it is a
  // defect of the store itself — reported before anything resolves through it.
  const byId = new Map<string, number>()
  for (const c of claims.claims) byId.set(c.id, (byId.get(c.id) ?? 0) + 1)
  for (const [id, count] of byId) {
    if (count > 1) {
      errors.push({ file: CLAIMS_REL, message: `duplicate claim id "${id}" (${count} claims share it)` })
    }
  }

  const identities = new Set(claims.claims.map(guardClaimKey))

  for (const { scenario, file } of scenarios) {
    // Teardown steps included — a `dashboard uninstall` teardown step legitimately
    // proves the uninstall claim, so its milestone tag resolves like any other.
    for (const [i, step] of guardExecutionSteps(scenario).entries()) {
      for (const id of milestoneClaims(step.milestone)) {
        if (byId.has(id)) continue
        errors.push({
          file,
          message: `step ${i + 1} names milestone claim "${id}", which no claim in ${CLAIMS_REL} declares`,
        })
      }
    }
  }

  for (const flow of flows?.flows ?? []) {
    for (const m of flow.milestones) {
      if (identities.has(guardClaimKey({ doc: m.doc, anchor: m.anchor, title: m.claimTitle }))) continue
      errors.push({
        file: FLOWS_REL,
        message: `flow "${flow.id}" milestone ${m.order} names claim ${m.doc}#${m.anchor} “${m.claimTitle}”, which ${CLAIMS_REL} does not declare`,
      })
    }
  }

  for (const c of flows?.noFlowClaims ?? []) {
    if (identities.has(guardClaimKey({ doc: c.doc, anchor: c.anchor, title: c.claimTitle }))) continue
    errors.push({
      file: FLOWS_REL,
      message: `noFlowClaims names claim ${c.doc}#${c.anchor} “${c.claimTitle}”, which ${CLAIMS_REL} does not declare`,
    })
  }

  return errors
}
