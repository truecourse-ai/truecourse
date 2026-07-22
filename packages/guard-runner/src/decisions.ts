/**
 * Read/write `.truecourse/scenarios/decisions.json` — the committable, user-authored
 * guard decisions file (the guard analogue of the spec-consolidator's decisions
 * file). Today it holds `dismissedClaims`: findings the user judged noise/won't-fix.
 * `guard generate` consults it to skip dismissed claims; the dashboard + CLI write
 * it via `dismiss`/`undismiss`. A missing or corrupt file reads as empty so a stale
 * file never blocks a run.
 */

import fs from 'node:fs'
import {
  GuardDecisionsSchema,
  EMPTY_GUARD_DECISIONS,
  dismissedClaimKey,
  guardFindingKey,
  type GuardDecisions,
  type GuardDismissedClaim,
  type GuardDismissedFinding,
  type GuardFindingIdentity,
} from '@truecourse/shared'
import { guardDecisionsPath, atomicWriteJson } from './store.js'

export { guardDecisionsPath } from './store.js'

/** Read + validate the decisions file, falling back to an empty one when absent
 *  or unreadable (a stale/corrupt file must never block generate). */
export function readGuardDecisions(repoRoot: string): GuardDecisions {
  const file = guardDecisionsPath(repoRoot)
  if (!fs.existsSync(file)) return EMPTY_GUARD_DECISIONS
  try {
    const parsed = GuardDecisionsSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')))
    return parsed.success ? parsed.data : EMPTY_GUARD_DECISIONS
  } catch {
    return EMPTY_GUARD_DECISIONS
  }
}

/** Write the decisions file atomically. */
export function writeGuardDecisions(repoRoot: string, decisions: GuardDecisions): string {
  const target = guardDecisionsPath(repoRoot)
  atomicWriteJson(target, decisions)
  return target
}

/**
 * Add a dismissal (idempotent on doc+anchor+title identity — a re-dismiss refreshes
 * `dismissedAt`/`note` in place, never duplicates), returning the updated file.
 */
export function dismissGuardClaim(
  repoRoot: string,
  claim: GuardDismissedClaim,
): GuardDecisions {
  const decisions = readGuardDecisions(repoRoot)
  const key = dismissedClaimKey(claim.doc, claim.anchor, claim.title)
  const dismissedClaims = decisions.dismissedClaims.filter(
    (d) => dismissedClaimKey(d.doc, d.anchor, d.title) !== key,
  )
  dismissedClaims.push(claim)
  const next: GuardDecisions = { ...decisions, dismissedClaims }
  writeGuardDecisions(repoRoot, next)
  return next
}

/** Remove a dismissal by identity (no-op when absent), returning the updated file. */
export function undismissGuardClaim(
  repoRoot: string,
  identity: { doc: string; anchor: string; title: string },
): GuardDecisions {
  const decisions = readGuardDecisions(repoRoot)
  const key = dismissedClaimKey(identity.doc, identity.anchor, identity.title)
  const next: GuardDecisions = {
    ...decisions,
    dismissedClaims: decisions.dismissedClaims.filter(
      (d) => dismissedClaimKey(d.doc, d.anchor, d.title) !== key,
    ),
  }
  writeGuardDecisions(repoRoot, next)
  return next
}

/**
 * Add a per-finding dismissal (idempotent on doc+anchor+scenarioHash identity — a
 * re-dismiss refreshes the entry in place, never duplicates), returning the
 * updated file. The legacy `dismissedClaims` array is untouched.
 */
export function dismissGuardFinding(
  repoRoot: string,
  finding: GuardDismissedFinding,
): GuardDecisions {
  const decisions = readGuardDecisions(repoRoot)
  const key = guardFindingKey(finding.doc, finding.anchor, finding.scenarioHash)
  const dismissedFindings = (decisions.dismissedFindings ?? []).filter(
    (f) => guardFindingKey(f.doc, f.anchor, f.scenarioHash) !== key,
  )
  dismissedFindings.push(finding)
  const next: GuardDecisions = { ...decisions, dismissedFindings }
  writeGuardDecisions(repoRoot, next)
  return next
}

/** Remove a per-finding dismissal by identity (no-op when absent), returning the
 *  updated file. Needs no finding lookup — the entry may legitimately refer to a
 *  scenario no report currently serves. */
export function undismissGuardFinding(
  repoRoot: string,
  identity: GuardFindingIdentity,
): GuardDecisions {
  const decisions = readGuardDecisions(repoRoot)
  const key = guardFindingKey(identity.doc, identity.anchor, identity.scenarioHash)
  const next: GuardDecisions = {
    ...decisions,
    dismissedFindings: (decisions.dismissedFindings ?? []).filter(
      (f) => guardFindingKey(f.doc, f.anchor, f.scenarioHash) !== key,
    ),
  }
  writeGuardDecisions(repoRoot, next)
  return next
}
