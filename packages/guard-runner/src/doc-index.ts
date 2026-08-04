/**
 * Collect the section indexes for a run's documents. The set is the docs the
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
import { nodeRefContext } from '@truecourse/shared/openapi-node'
import { buildDocSectionIndex, type DocSectionIndex } from './section-index.js'

// The single node-side RefResolutionContext factory (symlink-safe, pre-cap guarded)
// lives in @truecourse/shared/openapi-node so guard-runner and spec-consolidator
// share ONE implementation. Re-exported so the guard-runner public surface (which
// section-plan / run import from) is unchanged.
export { nodeRefContext } from '@truecourse/shared/openapi-node'

export interface RepoDocIndexes {
  /** Doc path → its section index, for docs that exist on disk. */
  indexes: Map<string, DocSectionIndex>
  /** Docs that were referenced but do not exist on disk. */
  missing: Set<string>
}

const CorpusShape = z
  .object({ docs: z.array(z.object({ ref: z.string() }).passthrough()).optional() })
  .passthrough()

export function corpusKeptDocs(repoRoot: string): string[] {
  const file = path.join(repoRoot, '.truecourse', 'specs', 'corpus.json')
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
 * Index the union of the corpus-kept docs and `boundDocs`. Each doc is read from
 * disk once; a referenced doc that is absent lands in `missing` (its scenarios
 * resolve as orphaned).
 */
export function indexRepoDocs(repoRoot: string, boundDocs: Iterable<string>): RepoDocIndexes {
  const wanted = new Set<string>(boundDocs)
  for (const ref of corpusKeptDocs(repoRoot)) wanted.add(ref)

  const indexes = new Map<string, DocSectionIndex>()
  const missing = new Set<string>()
  for (const doc of wanted) {
    const abs = path.resolve(repoRoot, doc)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      missing.add(doc)
      continue
    }
    indexes.set(doc, buildDocSectionIndex(doc, fs.readFileSync(abs, 'utf-8'), nodeRefContext(repoRoot, abs)))
  }
  return { indexes, missing }
}
