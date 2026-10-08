/**
 * Read the document trees for a run's documents. The set is the docs the
 * scenarios bind to, unioned with the corpus-kept docs when
 * `.truecourse/specs/corpus.json` exists — guard works with or without a corpus,
 * and a repo may have scenarios bound to a doc the corpus never mentions.
 *
 * The corpus is read through a minimal, tolerant local schema (just the kept
 * docs' refs) rather than importing the spec-consolidator package, keeping the
 * runner dependency-lean.
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseDocTree, type DocTree } from '@truecourse/shared'
import { corpusFilePath } from '@truecourse/shared/work-tree'

export interface RepoDocTrees {
  /** Doc path → its tree, for docs that exist on disk. */
  trees: Map<string, DocTree>
  /** Docs that were referenced but do not exist on disk. */
  missing: Set<string>
}

const CorpusShape = z
  .object({ docs: z.array(z.object({ ref: z.string() }).passthrough()).optional() })
  .passthrough()

export function corpusKeptDocs(repoRoot: string): string[] {
  const file = corpusFilePath(repoRoot)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = CorpusShape.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')))
    if (!parsed.success) return []
    return (parsed.data.docs ?? []).map((d) => d.ref)
  } catch {
    return []
  }
}

/**
 * Parse the union of the corpus-kept docs and `boundDocs`. Each doc is read from
 * disk once; a referenced doc that is absent lands in `missing` (its scenarios
 * resolve as orphaned).
 */
export function readRepoDocTrees(repoRoot: string, boundDocs: Iterable<string>): RepoDocTrees {
  const wanted = new Set<string>(boundDocs)
  for (const ref of corpusKeptDocs(repoRoot)) wanted.add(ref)

  const trees = new Map<string, DocTree>()
  const missing = new Set<string>()
  for (const doc of wanted) {
    const abs = path.resolve(repoRoot, doc)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      missing.add(doc)
      continue
    }
    trees.set(doc, parseDocTree(doc, fs.readFileSync(abs, 'utf-8')))
  }
  return { trees, missing }
}
