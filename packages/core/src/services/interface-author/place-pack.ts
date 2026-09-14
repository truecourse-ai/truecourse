import path from 'node:path'
import fs from 'node:fs'
import type { WebPlaceContext } from '@truecourse/interface-mapper'
import { readSource, type SourcePosition, type SourceRange } from '../agent/source-view.js'
import { sourceUnitView, type SourceGap } from './source-evidence.js'

export const MAX_PLACE_PACK_BYTES = 24_000
export interface PlaceSourceEntry {
  path: string
  status: 'shared-complete' | 'complete' | 'partial' | 'omitted-budget' | 'unavailable'
  /** Outer bounds only; omitted lists any gaps between these positions. */
  range?: { first: SourceRange; last: SourceRange }
  next?: SourcePosition
  hash?: string
  /** Every omitted interval, with exclusive end positions; ranges may be disjoint. */
  omitted?: SourceGap[]
  units?: { start: number; end: number; name: string }[]
}
export interface PlaceSourcePack {
  text: string
  bytes: number
  entries: PlaceSourceEntry[]
  manifestComplete: boolean
}

/** Automatically inject mapped code modules; exclude non-code configuration and key files. */
export function readPackSource(repoRoot: string, file: string): string | undefined {
  const isCode = (candidate: string) => /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(candidate) && !path.basename(candidate).startsWith('.')
  if (!isCode(file)) return undefined
  try {
    if (!isCode(fs.realpathSync(path.resolve(repoRoot, file)))) return undefined
    return readSource(repoRoot, file)
  } catch { return undefined }
}

/** Route first, then mapped views. Keep the source slice and its coverage together. */
export function placeSourcePack(
  repoRoot: string,
  context: WebPlaceContext | undefined,
  sharedComplete: readonly string[] = [],
): PlaceSourcePack | undefined {
  if (!context) return undefined
  const normalize = (file: string) => path.relative(path.resolve(repoRoot), path.resolve(repoRoot, file)).split(path.sep).join('/')
  const shared = new Set(sharedComplete.map(normalize))
  const candidates = [...new Set([context.module, ...context.renders].map(normalize))]
  const head = 'Source for this place. Complete source units retain every branch in those declarations. Partial files list gaps and omitted declarations; inspect those and dependencies before claiming coverage. Use read_files for independent omitted ranges. Mapping is a starting set, not proof that every control was inspected.'
  const entries: PlaceSourceEntry[] = []
  const blocks: string[] = []
  // Metadata stays bounded independently of the source and counts every candidate.
  let remaining = MAX_PLACE_PACK_BYTES - Buffer.byteLength(head) - 4_100
  let unsupplied = candidates.filter(file => !shared.has(file)).length
  for (const file of candidates) {
    if (shared.has(file)) { entries.push({ path: file, status: 'shared-complete' }); continue }
    const allocation = Math.min(remaining, Math.max(4_000, Math.floor(remaining / Math.max(1, unsupplied))))
    unsupplied--
    if (remaining < 512) { entries.push({ path: file, status: 'omitted-budget' }); continue }
    const source = readPackSource(repoRoot, file)
    if (source === undefined) { entries.push({ path: file, status: 'unavailable' }); continue }
    try {
      const view = sourceUnitView(file, source, allocation)
      entries.push({ path: file, status: view.complete ? 'complete' : 'partial',
        range: { first: view.ranges[0], last: view.ranges[view.ranges.length - 1] },
        hash: view.hash, omitted: view.omitted,
        ...(view.units.length ? { units: view.units.map(({ start, end, name }) => ({ start, end, name })) } : {}),
        ...(view.next ? { next: view.next } : {}) })
      blocks.push(view.content)
      remaining -= Buffer.byteLength(view.content) + 2
    } catch { entries.push({ path: file, status: 'omitted-budget' }) }
  }
  const rows: string[] = []
  let manifestBytes = 0
  // Always prioritize coverage for source actually supplied.
  const ordered = [...entries.filter(e => e.range), ...entries.filter(e => !e.range)]
  for (const entry of ordered) {
    const row = JSON.stringify(entry)
    if (manifestBytes + Buffer.byteLength(row) + 2 > 3_700) break
    rows.push(row)
    manifestBytes += Buffer.byteLength(row) + 2
  }
  const manifestComplete = rows.length === entries.length
  const manifest = `Source manifest: ${entries.length} candidates, ${rows.length} entries shown. Columns count Unicode code points; ends are exclusive. first/last are outer bounds; omitted lists every gap within or outside them. ` +
    (manifestComplete ? 'Complete manifest.' : `Manifest incomplete: ${entries.length - rows.length} entries omitted; consult the mapped module list.`)
  const text = [head, manifest, ...rows, ...blocks].join('\n\n')
  return { text, bytes: Buffer.byteLength(text), entries, manifestComplete }
}
