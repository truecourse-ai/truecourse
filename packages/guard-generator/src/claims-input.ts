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
import { ClaimsFileSchema, parseDocTree, sentenceKey, type Claim, type ClaimsFile, type DocTree } from '@truecourse/shared'
import { specClaimsFilePath } from '@truecourse/shared/work-tree'

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
