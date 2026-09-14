/**
 * THE CLUSTER PACK — the modules a cluster's places all render, read once and
 * handed to every session of that cluster as the message it opens with.
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

import type { PlaceCluster } from './cluster.js'
import { renderFileView } from '../agent/repo-tools.js'
import { readPackSource } from './place-pack.js'
import { sourceLines } from '../agent/source-view.js'
import { sourceEvidence } from './source-evidence.js'

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
  const head = 'Shared source, provided in full. Do NOT `read_file` any of them again. Read their dependencies when needed.'
  // Leave room for a bounded omission manifest, including pathological path lists.
  const sourceBudget = MAX_PACK_BYTES - Buffer.byteLength(head) - 4_100
  let bytes = 0
  for (const module of cluster.shared) {
    const source = readPackSource(repoRoot, module)
    if (source === undefined) continue
    const lines = sourceLines(source)
    const evidence = sourceEvidence(module, source)
    const block = `Source SHA-256: ${evidence.hash}\n` + renderFileView({ path: module, lines, start: 1, total: lines.length })
    const size = Buffer.byteLength(block) + 2
    if (bytes + size > sourceBudget) {
      omitted.push(module)
      continue
    }
    bytes += size
    blocks.push(block)
    modules.push(module)
  }
  if (modules.length === 0) return undefined
  const omissionRows: string[] = []
  let manifestBytes = 0
  for (const module of omitted) {
    const row = `  ${module}`
    if (manifestBytes + Buffer.byteLength(row) + 1 > 3_800) break
    omissionRows.push(row)
    manifestBytes += Buffer.byteLength(row) + 1
  }
  const manifest = omitted.length
    ? `Shared modules that did not fit: ${omitted.length}. Read when needed.\n${omissionRows.join('\n')}` +
      (omissionRows.length < omitted.length ? `\nManifest incomplete: ${omitted.length - omissionRows.length} additional paths omitted.` : '')
    : ''
  const text = [head, manifest, ...blocks].filter(Boolean).join('\n\n')
  return { text, modules, omitted, bytes: Buffer.byteLength(text) }
}
