/**
 * THE CLUSTER PACK — the modules a cluster's places all render, read once and
 * handed to every session of that cluster as the message it opens with
 * (SPEC_GUARD_PLAN item 8).
 *
 * The saving is not the bytes; it is the TURNS. A session that has not been
 * given a module spends a turn searching for it and a turn reading it, and the
 * result of that read is then resent on every turn after it — so eight sessions
 * reading the same eight files pay for those reads eight times over, at
 * ever-growing history. Provided up front, the same bytes are one prefix: the
 * read turns are gone, and the prefix itself is byte-identical across the
 * cluster, which is the only shape a provider's prompt cache can reuse between
 * sessions — the loop's `sharedPrefix`.
 *
 * TWO RULES the format follows, and both are about not lying to the session:
 *
 *  - a module is packed WHOLE or not at all. The pack says "do not read these
 *    again", and half a file with that instruction on it is worse than no file.
 *  - what did not fit is NAMED. A session told which shared modules were left
 *    out reads exactly those; a session told nothing assumes it has everything.
 *
 * The rendering is `read_file`'s own ({@link renderFileView}), so a module the
 * pack carries looks exactly like a module the session read for itself.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { PlaceCluster } from './cluster.js'
import { renderFileView } from './file-view.js'

/**
 * How many bytes of module content one pack carries. Sized at the measured
 * clusters' intersections (5–12 component files, a few KB each) with room to
 * spare; past it the prefix stops being cheaper than the reads it replaces.
 */
export const MAX_PACK_BYTES = 60_000

export interface ClusterPack {
  /** The opening message every session of the cluster shares, byte for byte. */
  text: string
  /** The modules the pack carries whole, in the order it states them. */
  modules: string[]
  /** Shared modules left out — the pack names them, and so does {@link text}. */
  omitted: string[]
  bytes: number
}

/**
 * Build the pack for one cluster, or `undefined` when there is nothing to
 * share: a cluster of one, a cluster whose shared modules are all unreadable
 * (a path that moved between the analyzer pass and now), or one whose first
 * shared module is already past the budget.
 */
export function clusterPack(repoRoot: string, cluster: PlaceCluster): ClusterPack | undefined {
  if (cluster.places.length < 2 || cluster.shared.length === 0) return undefined

  const blocks: string[] = []
  const modules: string[] = []
  const omitted: string[] = []
  let bytes = 0
  for (const module of cluster.shared) {
    const source = read(repoRoot, module)
    if (source === undefined) continue
    const lines = source.split('\n')
    const block = renderFileView({ path: module, lines, start: 1, total: lines.length })
    // Whole file or nothing — and the budget is checked per module rather than
    // broken out of, so one oversized module does not cost the small ones after it.
    if (bytes + block.length > MAX_PACK_BYTES) {
      omitted.push(module)
      continue
    }
    bytes += block.length
    blocks.push(block)
    modules.push(module)
  }
  if (modules.length === 0) return undefined

  const text = [
    `Before the place you author: the modules below are rendered by EVERY place in`,
    `this group, so they are provided here in full rather than read one by one.`,
    ``,
    `They are already in your context. Do NOT \`read_file\` any of them again —`,
    `read what they lead to, and the module that is your own place.`,
    ...(omitted.length > 0
      ? [
          ``,
          `These are shared too but did not fit; read them yourself if you need them:`,
          ...omitted.map((module) => `  ${module}`),
        ]
      : []),
    ``,
    ...blocks.flatMap((block) => [block, ``]),
  ]
    .join('\n')
    .trimEnd()

  return { text, modules, omitted, bytes }
}

/** The module's source, or `undefined` for anything that is not a readable file. */
function read(repoRoot: string, module: string): string | undefined {
  const target = path.resolve(repoRoot, module)
  // The paths come from the analyzer pass, not from a model — but they are
  // still paths, and the pack has no business leaving the repository.
  const rel = path.relative(path.resolve(repoRoot), target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined
  try {
    if (!fs.statSync(target).isFile()) return undefined
    return fs.readFileSync(target, 'utf-8')
  } catch {
    return undefined
  }
}
