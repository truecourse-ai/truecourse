/**
 * The claims a generate run composes its flows from: what the scan read from
 * the corpus's documents, materialized into the work tree as
 * `specs/claims.json`. A claim names its sentences by key, so this module
 * places each one in the live document: the section whose own text holds the
 * claim's first sentence is the anchor the flows bind until bindings go by
 * sentence, and a claim whose sentences the live document no longer holds is
 * reported rather than placed.
 */

import fs from 'node:fs'
import {
  ClaimsFileSchema,
  dismissedClaimKey,
  parseDocTree,
  sentenceKey,
  type Claim,
  type ClaimsFile,
  type DocTree,
  type GuardCoverageGap,
  type GuardDismissedClaim,
} from '@truecourse/shared'
import { specClaimsFilePath } from '@truecourse/shared/work-tree'
import type { FlowAreaDocInput, FlowClaimInput } from './flows.js'
import type { GuardDoc } from './section-plan.js'

/** The claims file of a work tree, or null when the tree carries none. */
export function readSpecClaims(repoRoot: string): ClaimsFile | null {
  const file = specClaimsFilePath(repoRoot)
  if (!fs.existsSync(file)) return null
  return ClaimsFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')))
}

/** A claim placed in its live document. */
export interface PlacedClaim {
  claim: Claim
  /** The anchor of the section whose own text holds the claim's first sentence. */
  anchor: string
}

export interface ClaimPlacement {
  placed: PlacedClaim[]
  /** Claims whose sentences the live document no longer holds, with the keys that failed. */
  unplaced: Array<{ claim: Claim; missing: string[] }>
}

/**
 * Place every claim of `docs` in its live document. `treeOf` gives a document's
 * tree, or null for a document the tree does not hold; its claims are unplaced.
 */
export function placeClaims(claims: readonly Claim[], treeOf: (doc: string) => DocTree | null): ClaimPlacement {
  const placed: PlacedClaim[] = []
  const unplaced: ClaimPlacement['unplaced'] = []
  const byDoc = new Map<string, Map<string, number>>()
  const sentenceLines = (tree: DocTree): Map<string, number> => {
    let lines = byDoc.get(tree.doc)
    if (!lines) {
      lines = new Map(tree.sentences.map((s) => [sentenceKey(s.text, s.repeat), s.startLine]))
      byDoc.set(tree.doc, lines)
    }
    return lines
  }
  for (const claim of claims) {
    const tree = treeOf(claim.doc)
    if (!tree) {
      unplaced.push({ claim, missing: [...claim.sentences] })
      continue
    }
    const lines = sentenceLines(tree)
    const missing = claim.sentences.filter((key) => !lines.has(key))
    if (missing.length > 0) {
      unplaced.push({ claim, missing })
      continue
    }
    const first = Math.min(...claim.sentences.map((key) => lines.get(key)!))
    placed.push({ claim, anchor: sectionAt(tree, first) })
  }
  return { placed, unplaced }
}

/** The anchor of the section whose own text holds a line; the last section opened above it otherwise. */
function sectionAt(tree: DocTree, line: number): string {
  const own = tree.sections.find((s) => s.startLine <= line && line <= s.ownEndLine)
  if (own) return own.anchor
  const above = [...tree.sections].reverse().find((s) => s.startLine <= line)
  return (above ?? tree.sections[0]!).anchor
}

/** The tree of each document under `repoRoot` that `docs` names and the tree holds. */
export function docTreesOf(repoRoot: string, docs: Iterable<string>): (doc: string) => DocTree | null {
  const trees = new Map<string, DocTree | null>()
  return (doc) => {
    if (!trees.has(doc)) {
      const abs = `${repoRoot}/${doc}`
      trees.set(doc, fs.existsSync(abs) ? parseDocTree(doc, fs.readFileSync(abs, 'utf-8')) : null)
    }
    return trees.get(doc)!
  }
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
  /** The claims placed in those documents. */
  placed: readonly PlacedClaim[]
  /** Each document's canonical area ids. */
  areaTagsByDoc: ReadonlyMap<string, readonly string[]>
  /** The user's dismissals, by {@link dismissedClaimKey}; a dismissed claim enters no flow. */
  dismissals: ReadonlyMap<string, GuardDismissedClaim>
  /** `doc\0sentenceKey` of every sentence a conflict verdict rejected; a claim read from one enters no flow. */
  suppressed: ReadonlySet<string>
}

export interface ClaimAreaInputs {
  /** One entry per document: its outline, its untestable sections and its live claims. */
  inputs: FlowAreaDocInput[]
  /** The claim-level coverage gaps the claims themselves settle: dismissed, untestable, no-claim. */
  gaps: GuardCoverageGap[]
  /** One line per document for the run's facts, plus one per claim left out. */
  lines: string[]
  /** The {@link dismissedClaimKey} of every placed claim, for orphaned-dismissal accounting. */
  claimKeys: Set<string>
}

/**
 * The flow synthesis inputs the placed claims give: per document, the live
 * claims (testable, not dismissed, not read from a rejected sentence) and the
 * sections that are untestable or state no claim. The run and the pre-flight
 * estimate both derive their areas through this, so the session keys the
 * estimate probes are the keys the run uses.
 */
export function claimAreaInputs(opts: ClaimAreaInputsOptions): ClaimAreaInputs {
  const placedByDoc = new Map<string, PlacedClaim[]>()
  for (const p of opts.placed) {
    const list = placedByDoc.get(p.claim.doc)
    if (list) list.push(p)
    else placedByDoc.set(p.claim.doc, [p])
  }
  const inputs: FlowAreaDocInput[] = []
  const gaps: GuardCoverageGap[] = []
  const lines: string[] = []
  const claimKeys = new Set<string>()
  for (const doc of opts.docs) {
    const placed = placedByDoc.get(doc.doc) ?? []
    const live: FlowClaimInput[] = []
    const untestable: { anchor: string; reason: string }[] = []
    for (const s of doc.sections) {
      const here = placed.filter((p) => p.anchor === s.anchor)
      const reasons: string[] = []
      let kept = 0
      for (const { claim, anchor } of here) {
        const key = dismissedClaimKey(doc.doc, anchor, claim.statement)
        claimKeys.add(key)
        if (claim.sentences.some((sentence) => opts.suppressed.has(`${doc.doc}\0${sentence}`))) {
          lines.push(`${doc.doc}: "${oneLine(claim.statement)}" left out, a resolved conflict rejected its sentence`)
          continue
        }
        const dismissal = opts.dismissals.get(key)
        if (dismissal) {
          gaps.push({ doc: doc.doc, anchor, kind: 'dismissed', reason: dismissedReason(claim.statement, dismissal.note) })
          continue
        }
        if (claim.testable !== true) {
          reasons.push(claim.testable.reason)
          continue
        }
        kept++
        live.push({ id: claim.id, doc: doc.doc, anchor, title: claim.statement, sentences: claim.sentences })
      }
      if (reasons.length > 0) {
        const reason = `not testable: ${[...new Set(reasons)].join(', ')}`
        untestable.push({ anchor: s.anchor, reason })
        if (kept === 0) gaps.push({ doc: doc.doc, anchor: s.anchor, kind: 'untestable', reason })
      } else if (here.length === 0) {
        gaps.push({ doc: doc.doc, anchor: s.anchor, kind: 'no-claim', reason: 'the section states no claim' })
      }
    }
    lines.push(`${doc.doc}: ${live.length} testable claim${live.length === 1 ? '' : 's'} from the scan`)
    inputs.push({
      doc: doc.doc,
      areaTags: [...(opts.areaTagsByDoc.get(doc.doc) ?? [])],
      outline: doc.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
      untestable,
      claims: live,
    })
  }
  return { inputs, gaps, lines, claimKeys }
}
