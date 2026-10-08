/**
 * The claims a generate run composes its flows from: what the scan read from
 * the corpus's documents, materialized into the work tree as
 * `specs/claims.json`. A claim names its sentences by key, so this module
 * checks each one against the live document: a claim whose sentences the
 * document still holds is live, and one whose sentences it no longer holds is
 * reported rather than composed.
 */

import fs from 'node:fs'
import { ClaimsFileSchema, sentencesByKey, type Claim, type ClaimsFile, type DocTree, type GuardDismissedClaim } from '@truecourse/shared'
import { specClaimsFilePath } from '@truecourse/shared/work-tree'
import type { FlowAreaDocInput, FlowClaimInput } from './flows.js'
import type { GuardDoc } from './section-plan.js'

/** The claims file of a work tree, or null when the tree carries none. */
export function readSpecClaims(repoRoot: string): ClaimsFile | null {
  const file = specClaimsFilePath(repoRoot)
  if (!fs.existsSync(file)) return null
  return ClaimsFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')))
}

export interface ClaimPlacement {
  /** Claims whose every sentence the live document holds. */
  live: Claim[]
  /** Claims whose sentences the live document no longer holds, with the keys that failed. */
  unplaced: Array<{ claim: Claim; missing: string[] }>
}

/**
 * Check every claim of `docs` against its live document. `treeOf` gives a
 * document's tree, or null for a document the tree does not hold; its claims
 * are unplaced.
 */
export function placeClaims(claims: readonly Claim[], treeOf: (doc: string) => DocTree | null): ClaimPlacement {
  const live: Claim[] = []
  const unplaced: ClaimPlacement['unplaced'] = []
  const byDoc = new Map<string, Map<string, unknown>>()
  for (const claim of claims) {
    const tree = treeOf(claim.doc)
    if (!tree) {
      unplaced.push({ claim, missing: [...claim.sentences] })
      continue
    }
    let keys = byDoc.get(claim.doc)
    if (!keys) byDoc.set(claim.doc, (keys = sentencesByKey(tree)))
    const missing = claim.sentences.filter((key) => !keys.has(key))
    if (missing.length > 0) unplaced.push({ claim, missing })
    else live.push(claim)
  }
  return { live, unplaced }
}

/** The whole of a text on one line, cut at 120 characters. */
export function oneLine(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}

/** The `dismissed` coverage-gap reason: the subject one-liner, plus the note if any. */
export function dismissedReason(subject: string, note?: string): string {
  const base = `dismissed: ${oneLine(subject)}`
  return note ? `${base} — ${oneLine(note)}` : base
}

export interface ClaimAreaInputsOptions {
  /** Every document of the universe, with its sections. */
  docs: readonly GuardDoc[]
  /** The live claims of those documents. */
  claims: readonly Claim[]
  /** The user's dismissals, by claim id; a dismissed claim enters no flow. */
  dismissals: ReadonlyMap<string, GuardDismissedClaim>
  /** `doc\0sentenceKey` of every sentence a conflict verdict rejected; a claim read from one enters no flow. */
  suppressed: ReadonlySet<string>
}

export interface ClaimAreaInputs {
  /** One entry per document: its outline and its live, testable claims. */
  inputs: FlowAreaDocInput[]
  /** One line per document for the run's facts, plus one per claim left out. */
  lines: string[]
}

/**
 * The flow synthesis inputs the live claims give: per document, the claims
 * that are testable, not dismissed and not read from a rejected sentence. The
 * run and the pre-flight estimate both derive their areas through this, so the
 * session keys the estimate probes are the keys the run uses.
 */
export function claimAreaInputs(opts: ClaimAreaInputsOptions): ClaimAreaInputs {
  const byDoc = new Map<string, Claim[]>()
  for (const claim of opts.claims) {
    const list = byDoc.get(claim.doc)
    if (list) list.push(claim)
    else byDoc.set(claim.doc, [claim])
  }
  const inputs: FlowAreaDocInput[] = []
  const lines: string[] = []
  for (const doc of opts.docs) {
    const live: FlowClaimInput[] = []
    for (const claim of byDoc.get(doc.doc) ?? []) {
      if (claim.testable !== true) continue
      if (claim.sentences.some((sentence) => opts.suppressed.has(`${doc.doc}\0${sentence}`))) {
        lines.push(`${doc.doc}: "${oneLine(claim.statement)}" left out, a resolved conflict rejected its sentence`)
        continue
      }
      if (opts.dismissals.has(claim.id)) {
        lines.push(`${doc.doc}: "${oneLine(claim.statement)}" left out, dismissed`)
        continue
      }
      live.push({ id: claim.id, doc: doc.doc, title: claim.statement, sentences: claim.sentences })
    }
    lines.push(`${doc.doc}: ${live.length} testable claim${live.length === 1 ? '' : 's'} from the scan`)
    inputs.push({
      doc: doc.doc,
      areaTags: [...doc.areaTags],
      outline: doc.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
      claims: live,
    })
  }
  return { inputs, lines }
}
