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
  type GuardDecisions,
  type GuardDismissedClaim,
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
