import fs from 'node:fs'
import path from 'node:path'
import type {
  Adr,
  AdrDraft,
  AdrFlowFragmentLocator,
  AdrGraphFragmentLocator,
  AdrIndexEntry,
  AdrSections,
  AdrStatus,
  AdrTopicValue,
  FragmentSnapshot,
  GraphFragmentEdge,
  GraphFragmentNode,
  TopicSignature,
} from '@truecourse/shared'
import { AdrStatusSchema } from '@truecourse/shared'
import { atomicWriteJson } from './atomic-write.js'
import {
  getAdrCorpusPath,
  getAdrDraftPath,
  getAdrDraftsDir,
  getAdrRejectedPath,
  getRepoTruecourseDir,
} from '../config/paths.js'
import type { Graph } from '../types/snapshot.js'

// ---------------------------------------------------------------------------
// On-disk file shapes (internal)
// ---------------------------------------------------------------------------

export interface AdrCorpusFile {
  /** ISO-8601 timestamp of the last rebuild. */
  generatedAt: string
  /** Metadata-only index entries. Section bodies live in `docs/adr/*.md` and
   *  are loaded on demand via `loadAdrById`. */
  adrs: AdrIndexEntry[]
}

interface RejectedDraftsFile {
  /** Append-only log of rejected topic signatures. */
  signatures: TopicSignature[]
}

// ===========================================================================
// ADR store: on-disk layout + MADR parser/serializer + graph helpers
// ===========================================================================
//
// One module owns "how ADR state is represented on disk and in memory":
//
//   <repo>/.truecourse/
//     adrs.json                  parsed corpus (derived from docs/adr/*.md)
//     drafts/<draftId>.json      one file per pending draft
//     adr-rejected.json          rejected topic signatures (dedupe log)
//
//   <repo>/docs/adr/ADR-NNNN-<slug>.md   MADR files on disk (source of truth)
//
// Accepted ADR markdown files are the source of truth; `adrs.json` is a
// derived index rebuilt on analyze. The parser + serializer here handle
// round-tripping between markdown and the `Adr` record; `collectGraphEntityIds`
// powers both the suggester's entity validation and the staleness check.

// ---------------------------------------------------------------------------
// Corpus (`adrs.json`) — mtime-keyed in-memory cache
// ---------------------------------------------------------------------------

const corpusCache = new Map<string, { mtime: number; data: AdrCorpusFile }>()

export function readAdrCorpus(repoDir: string): AdrCorpusFile | null {
  const file = getAdrCorpusPath(repoDir)
  let mtime: number
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      corpusCache.delete(repoDir)
      return null
    }
    throw err
  }
  const cached = corpusCache.get(repoDir)
  if (cached && cached.mtime === mtime) return cached.data
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as AdrCorpusFile
  corpusCache.set(repoDir, { mtime, data })
  return data
}

export function writeAdrCorpus(repoDir: string, corpus: AdrCorpusFile): void {
  atomicWriteJson(getAdrCorpusPath(repoDir), corpus)
  corpusCache.delete(repoDir)
}

export function deleteAdrCorpus(repoDir: string): void {
  try {
    fs.unlinkSync(getAdrCorpusPath(repoDir))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  corpusCache.delete(repoDir)
}

// ---------------------------------------------------------------------------
// Drafts (`drafts/<draftId>.md`) — MADR files with draft-only frontmatter
// ---------------------------------------------------------------------------
//
// A draft is a real MADR file with extra frontmatter fields the accepted
// format doesn't carry:
//
//   ---
//   status: proposed
//   date: 2026-04-21
//   title: Accept circular dependency between auth and billing
//   topic: circular-dependency
//   entities: [auth-service, billing-service]
//   confidence: 0.8
//   draft-id: draft-abc
//   created-at: 2026-04-21T10:00:00.000Z
//   ---
//
//   # Accept circular dependency between auth and billing
//
//   ## Context ...
//   ## Decision ...
//   ## Consequences ...
//
// Stored this way (rather than JSON-wrapped markdown) so the body is
// editable in $EDITOR directly and `cat`-readable. On accept, draft-only
// fields are stripped, accepted-ADR fields added, and the file moves to
// `docs/adr/ADR-NNNN-<slug>.md`.

export function writeAdrDraft(repoDir: string, draft: AdrDraft): void {
  fs.mkdirSync(getAdrDraftsDir(repoDir), { recursive: true })
  const file = getAdrDraftPath(repoDir, draft.id)
  const markdown = serializeAdrDraft(draft)
  // Atomic markdown write: write to tmp then rename.
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, markdown, 'utf-8')
  fs.renameSync(tmp, file)
}

export function readAdrDraft(repoDir: string, draftId: string): AdrDraft | null {
  const file = getAdrDraftPath(repoDir, draftId)
  if (!fs.existsSync(file)) return null
  const source = fs.readFileSync(file, 'utf-8')
  return parseAdrDraft({ filePath: file, source })
}

/** Read a draft and return both the parsed form and the raw `.md` source.
 *  The raw source is what the client's Raw mode textarea displays — same
 *  text the user will edit and send back via `writeAdrDraftRaw`. */
export function readAdrDraftWithSource(
  repoDir: string,
  draftId: string,
): { draft: AdrDraft; source: string } | null {
  const file = getAdrDraftPath(repoDir, draftId)
  if (!fs.existsSync(file)) return null
  const source = fs.readFileSync(file, 'utf-8')
  return { draft: parseAdrDraft({ filePath: file, source }), source }
}

/** Replace the draft's on-disk markdown with `source`. Validates via
 *  `parseAdrDraft` (the same parser used on reads) so a malformed edit
 *  can't corrupt the review queue. Returns the parsed draft so callers
 *  can return fresh data to the client. */
export function writeAdrDraftRaw(
  repoDir: string,
  draftId: string,
  source: string,
): AdrDraft {
  const file = getAdrDraftPath(repoDir, draftId)
  if (!fs.existsSync(file)) {
    throw new Error(`Draft ${draftId} not found`)
  }
  const parsed = parseAdrDraft({ filePath: file, source })
  if (parsed.id !== draftId) {
    throw new Error(
      `Raw draft edit changed draft-id ${draftId} → ${parsed.id}; refusing to rewrite a different record`,
    )
  }
  fs.mkdirSync(getAdrDraftsDir(repoDir), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, source, 'utf-8')
  fs.renameSync(tmp, file)
  return parsed
}

export function listAdrDrafts(repoDir: string): AdrDraft[] {
  const dir = getAdrDraftsDir(repoDir)
  if (!fs.existsSync(dir)) return []
  const drafts: AdrDraft[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const source = fs.readFileSync(path.join(dir, name), 'utf-8')
    try {
      drafts.push(parseAdrDraft({ filePath: path.join(dir, name), source }))
    } catch (err) {
      // Malformed drafts shouldn't crash the review queue. Log + skip.
      // (Logger is silent-fallback in most contexts; still useful when the
      // CLI entry point configures a sink.)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // Avoid circular import of logger by just using console for this edge.
      console.warn(`[adr-store] skipping malformed draft ${name}: ${(err as Error).message}`)
    }
  }
  // Chronological — oldest draft surfaces first in the review queue.
  return drafts.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function deleteAdrDraft(repoDir: string, draftId: string): void {
  try {
    fs.unlinkSync(getAdrDraftPath(repoDir, draftId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

// ---------------------------------------------------------------------------
// Rejected signatures (`adr-rejected.json`) — persistence + dedupe helpers
// ---------------------------------------------------------------------------
//
// A signature answers: "has the user already rejected a draft about this
// exact thing?" Shape: `{ topic, entities }` where entities is sorted.
//
// Two drafts produce equal signatures iff they share a topic AND entity set.
// Rewording is irrelevant (topic is from a fixed vocab); entity-order is
// irrelevant (sorted here). Signatures are persisted verbatim — no hashing —
// so the on-disk file is human-readable and trivially diffable in git.

export function readRejectedSignatures(repoDir: string): TopicSignature[] {
  const file = getAdrRejectedPath(repoDir)
  if (!fs.existsSync(file)) return []
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as RejectedDraftsFile
  return raw.signatures ?? []
}

export function appendRejectedSignature(repoDir: string, signature: TopicSignature): void {
  const current = readRejectedSignatures(repoDir)
  current.push(signature)
  writeRejectedSignatures(repoDir, current)
}

export function writeRejectedSignatures(repoDir: string, signatures: TopicSignature[]): void {
  const file = getAdrRejectedPath(repoDir)
  const wrapped: RejectedDraftsFile = { signatures }
  atomicWriteJson(file, wrapped)
}

export function computeSignature(draft: AdrDraft): TopicSignature {
  return {
    topic: draft.topic,
    entities: sortedUnique(draft.entities),
  }
}

export function isRejected(
  signature: TopicSignature,
  rejectedList: TopicSignature[],
): boolean {
  for (const rejected of rejectedList) {
    if (signaturesEqual(signature, rejected)) return true
  }
  return false
}

export function isDraftRejected(draft: AdrDraft, rejectedList: TopicSignature[]): boolean {
  return isRejected(computeSignature(draft), rejectedList)
}

/** Drop drafts whose signature is already rejected. Returns a new array. */
export function filterRejected<T extends AdrDraft>(
  drafts: T[],
  rejectedList: TopicSignature[],
): T[] {
  return drafts.filter((d) => !isDraftRejected(d, rejectedList))
}

function signaturesEqual(a: TopicSignature, b: TopicSignature): boolean {
  if (a.topic !== b.topic) return false
  if (a.entities.length !== b.entities.length) return false
  // Both sides must be sorted for a structural compare. Callers typically
  // produce `a` via computeSignature; `b` comes from the rejected file
  // which was also written via appendRejectedSignature(computeSignature(...)).
  // Still sort defensively in case a caller builds a signature by hand.
  const as = sortedUnique(a.entities)
  const bs = sortedUnique(b.entities)
  for (let i = 0; i < as.length; i++) {
    if (as[i] !== bs[i]) return false
  }
  return true
}

function sortedUnique(items: string[]): string[] {
  return Array.from(new Set(items)).sort()
}

// ---------------------------------------------------------------------------
// ADR lookup helpers
// ---------------------------------------------------------------------------
//
// `findAdrIndexEntryById` returns metadata only (fast — JSON index lookup).
// `loadAdrById` returns the full runtime `Adr` including parsed sections —
// that requires reading the MADR file from disk, so it's slower but
// rehydrates the body without carrying it in the index.

export function findAdrIndexEntryById(repoDir: string, adrId: string): AdrIndexEntry | null {
  const corpus = readAdrCorpus(repoDir)
  if (!corpus) return null
  return corpus.adrs.find((a) => a.id === adrId) ?? null
}

/** @deprecated retained for callers that still expect a metadata record;
 *  prefer `findAdrIndexEntryById` (semantically explicit) or `loadAdrById`
 *  (full body). Kept pointing to the index-entry form. */
export const findAdrById = findAdrIndexEntryById

export function loadAdrById(repoDir: string, adrId: string): Adr | null {
  const entry = findAdrIndexEntryById(repoDir, adrId)
  if (!entry) return null
  return loadAdrFromIndexEntry(repoDir, entry)
}

/** Same as `loadAdrById` but also returns the raw `.md` source — the
 *  text the client's Raw mode displays and edits. */
export function loadAdrByIdWithSource(
  repoDir: string,
  adrId: string,
): { adr: Adr; source: string } | null {
  const entry = findAdrIndexEntryById(repoDir, adrId)
  if (!entry) return null
  const absPath = path.isAbsolute(entry.path) ? entry.path : path.join(repoDir, entry.path)
  if (!fs.existsSync(absPath)) return null
  const source = fs.readFileSync(absPath, 'utf-8')
  const adr = loadAdrFromIndexEntry(repoDir, entry)
  if (!adr) return null
  return { adr, source }
}

/** Replace an accepted ADR's on-disk markdown with `source`. Validates
 *  via `parseAdr`; the resulting record must keep the same ADR id so
 *  corpus entries stay consistent. Returns the reloaded ADR. */
export function writeAdrRaw(repoDir: string, adrId: string, source: string): Adr {
  const entry = findAdrIndexEntryById(repoDir, adrId)
  if (!entry) throw new Error(`ADR ${adrId} not found`)
  const absPath = path.isAbsolute(entry.path) ? entry.path : path.join(repoDir, entry.path)
  if (!fs.existsSync(absPath)) throw new Error(`ADR file missing: ${absPath}`)
  const parsed = parseAdr({ filePath: absPath, source })
  if (parsed.id !== adrId) {
    throw new Error(
      `Raw ADR edit changed id ${adrId} → ${parsed.id}; refusing to rewrite a different record`,
    )
  }
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, source, 'utf-8')
  fs.renameSync(tmp, absPath)
  return parsed
}

/** Read the MADR file referenced by an index entry and rehydrate sections.
 *  Returns null if the file is missing — caller decides whether that's a
 *  "corpus drift" warning or just expected (deleted ADR). */
export function loadAdrFromIndexEntry(repoDir: string, entry: AdrIndexEntry): Adr | null {
  const absPath = path.isAbsolute(entry.path) ? entry.path : path.join(repoDir, entry.path)
  if (!fs.existsSync(absPath)) return null
  const source = fs.readFileSync(absPath, 'utf-8')
  const parsed = parseAdr({ filePath: entry.path, source })
  // Overlay metadata from the index (overlays like isStale, any link
  // edits that diverged post-accept via `adr link` / `adr unlink`, and
  // the decision-time fragment snapshots — those live on the index
  // entry, not in the .md file).
  return {
    ...parsed,
    linkedNodeIds: entry.linkedNodeIds,
    requiredEntities: entry.requiredEntities,
    isStale: entry.isStale,
    staleReasons: entry.staleReasons,
    sourceDraftId: entry.sourceDraftId ?? parsed.sourceDraftId,
    fragments: entry.fragments,
  }
}

export function findAdrsLinkedToNode(repoDir: string, nodeId: string): AdrIndexEntry[] {
  const corpus = readAdrCorpus(repoDir)
  if (!corpus) return []
  return corpus.adrs.filter((a) => a.linkedNodeIds.includes(nodeId))
}

/** Strip the section body from a full Adr, yielding the metadata-only form
 *  suitable for persistence in `adrs.json`. */
export function toAdrIndexEntry(adr: Adr): AdrIndexEntry {
  const { sections: _sections, ...entry } = adr
  return entry
}

// ---------------------------------------------------------------------------
// Ensure drafts dir exists — cheap to call from any writer
// ---------------------------------------------------------------------------

export function ensureAdrDraftsDir(repoDir: string): string {
  const dir = getAdrDraftsDir(repoDir)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Re-exported so callers building the `.truecourse/` directory get it here
// alongside the ADR-specific helpers.
export { getRepoTruecourseDir }

// ---------------------------------------------------------------------------
// Test-only: invalidate corpus cache
// ---------------------------------------------------------------------------

export function clearAdrCorpusCache(): void {
  corpusCache.clear()
}

// ===========================================================================
// MADR parsing / serialization
// ===========================================================================
//
// Parses and emits MADR markdown of the shape:
//
//   ---
//   status: accepted
//   date: 2026-04-21
//   deciders: [alice, bob]
//   supersedes: [ADR-0003]
//   superseded-by: ADR-0007
//   linked-node-ids: [svc-a, svc-b]
//   required-entities: [svc-a, svc-b]
//   source-draft-id: draft-abc
//   ---
//
//   # ADR-0005: Use an event bus for cross-service communication
//
//   ## Context ...
//   ## Decision ...
//   ## Consequences ...
//
// Only core MADR fields are required: status, date, title, context, decision,
// consequences. Everything else is optional. Malformed input throws
// `AdrParseError` — we surface errors rather than silently skipping files.

export class AdrParseError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly reason: string,
    public readonly partial?: Partial<Adr>,
  ) {
    super(`Failed to parse MADR file ${filePath}: ${reason}`)
    this.name = 'AdrParseError'
  }
}

// Minimal YAML subset (scalar, inline list, quoted string) — MADR frontmatter
// never needs more. Richer YAML fails loud rather than silently mis-parsing.

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/

interface Frontmatter {
  [key: string]: string | string[]
}

function parseFrontmatter(raw: string, filePath: string): Frontmatter {
  const out: Frontmatter = {}
  for (const line of raw.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const match = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) {
      throw new AdrParseError(filePath, `malformed frontmatter line: ${line}`)
    }
    const [, key, value] = match
    out[key] = parseScalarOrList(value.trim())
  }
  return out
}

function parseScalarOrList(value: string): string | string[] {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((s) => unquote(s.trim()))
  }
  return unquote(value)
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

const TITLE_RE = /^#\s+(ADR-\d{4,})\s*[:\-]\s*(.+?)\s*$/m

function parseBody(
  body: string,
  filePath: string,
): { id: string; number: number; title: string; sections: AdrSections } {
  const titleMatch = TITLE_RE.exec(body)
  if (!titleMatch) {
    throw new AdrParseError(
      filePath,
      'missing or malformed title — expected `# ADR-NNNN: Title` on its own line',
    )
  }
  const id = titleMatch[1]
  const title = titleMatch[2]
  const number = parseInt(id.slice(4), 10)
  if (!Number.isFinite(number) || number <= 0) {
    throw new AdrParseError(filePath, `invalid ADR number in title: ${id}`)
  }

  const sections = parseSections(body, filePath)
  return { id, number, title, sections }
}

function parseSections(body: string, filePath: string): AdrSections {
  // Split on H2 headings; section content runs until the next H2 or EOF.
  const sectionMap = new Map<string, string[]>()
  let current: string | null = null
  for (const line of body.split('\n')) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line)
    if (h2) {
      current = h2[1].toLowerCase().trim()
      sectionMap.set(current, [])
      continue
    }
    if (current) sectionMap.get(current)!.push(line)
  }

  const context = sectionMap.get('context')?.join('\n').trim()
  const decision = sectionMap.get('decision')?.join('\n').trim()
  const consequences = sectionMap.get('consequences')?.join('\n').trim()

  const missing: string[] = []
  if (!context) missing.push('Context')
  if (!decision) missing.push('Decision')
  if (!consequences) missing.push('Consequences')
  if (missing.length) {
    throw new AdrParseError(filePath, `missing required section(s): ${missing.join(', ')}`)
  }

  return { context: context!, decision: decision!, consequences: consequences! }
}

export interface ParseAdrOptions {
  filePath: string
  source: string
}

export function parseAdr({ filePath, source }: ParseAdrOptions): Adr {
  const match = FRONTMATTER_RE.exec(source)
  if (!match) {
    throw new AdrParseError(filePath, 'missing frontmatter block (`---` delimited)')
  }
  const [, rawFrontmatter, body] = match
  const fm = parseFrontmatter(rawFrontmatter, filePath)

  const status = readStatus(fm, filePath)
  const date = readRequiredScalar(fm, 'date', filePath)
  const deciders = readList(fm, 'deciders')
  const supersedes = readList(fm, 'supersedes')
  const supersededBy = readOptionalScalar(fm, 'superseded-by')
  const linkedNodeIds = readList(fm, 'linked-node-ids')
  const requiredEntities = readList(fm, 'required-entities') ?? linkedNodeIds ?? []
  const sourceDraftId = readOptionalScalar(fm, 'source-draft-id')

  const { id, number, title, sections } = parseBody(body, filePath)

  return {
    id,
    number,
    title,
    status,
    date,
    path: filePath,
    sections,
    deciders,
    linkedNodeIds: linkedNodeIds ?? [],
    supersedes,
    supersededBy,
    requiredEntities,
    sourceDraftId,
  }
}

export function serializeAdr(adr: Adr): string {
  const fm: string[] = ['---', `status: ${adr.status}`, `date: ${adr.date}`]
  if (adr.deciders?.length) fm.push(`deciders: ${formatList(adr.deciders)}`)
  if (adr.supersedes?.length) fm.push(`supersedes: ${formatList(adr.supersedes)}`)
  if (adr.supersededBy) fm.push(`superseded-by: ${adr.supersededBy}`)
  if (adr.linkedNodeIds.length) fm.push(`linked-node-ids: ${formatList(adr.linkedNodeIds)}`)
  if (adr.requiredEntities.length) fm.push(`required-entities: ${formatList(adr.requiredEntities)}`)
  if (adr.sourceDraftId) fm.push(`source-draft-id: ${adr.sourceDraftId}`)
  fm.push('---', '')

  const body = [
    `# ${adr.id}: ${adr.title}`,
    '',
    '## Context',
    '',
    adr.sections.context,
    '',
    '## Decision',
    '',
    adr.sections.decision,
    '',
    '## Consequences',
    '',
    adr.sections.consequences,
    '',
  ]

  return [...fm, ...body].join('\n')
}

function readStatus(fm: Frontmatter, filePath: string): AdrStatus {
  const raw = readRequiredScalar(fm, 'status', filePath)
  const parsed = AdrStatusSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AdrParseError(
      filePath,
      `invalid status "${raw}" — expected one of proposed, accepted, deprecated, superseded`,
    )
  }
  // `stale` is computed-only and must never appear in a file.
  if (parsed.data === 'stale') {
    throw new AdrParseError(filePath, '`stale` is a computed status and cannot appear in a file')
  }
  return parsed.data
}

function readRequiredScalar(fm: Frontmatter, key: string, filePath: string): string {
  const v = fm[key]
  if (v === undefined) throw new AdrParseError(filePath, `missing required field: ${key}`)
  if (Array.isArray(v)) throw new AdrParseError(filePath, `expected scalar for ${key}, got list`)
  if (v === '') throw new AdrParseError(filePath, `empty value for required field: ${key}`)
  return v
}

function readOptionalScalar(fm: Frontmatter, key: string): string | undefined {
  const v = fm[key]
  if (v === undefined || v === '') return undefined
  if (Array.isArray(v)) return undefined
  return v
}

function readList(fm: Frontmatter, key: string): string[] | undefined {
  const v = fm[key]
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v.filter((s) => s !== '')
  if (v === '') return []
  return [v]
}

function formatList(items: string[]): string {
  return `[${items.join(', ')}]`
}

// ---------------------------------------------------------------------------
// Draft parser / serializer
// ---------------------------------------------------------------------------
//
// Drafts share the MADR body shape with accepted ADRs (Context / Decision /
// Consequences sections) but carry extra draft-only frontmatter fields the
// accepted parser doesn't expect: `title` (free text since there's no
// ADR-NNNN yet), `topic`, `entities`, `confidence`, `draft-id`, `created-at`.
// We keep a separate parse/serialize pair rather than bending the accepted
// parser to also accept `ADR-XXXX` placeholders.

export function parseAdrDraft(opts: { filePath: string; source: string }): AdrDraft {
  const match = FRONTMATTER_RE.exec(opts.source)
  if (!match) {
    throw new AdrParseError(opts.filePath, 'missing frontmatter block (`---` delimited)')
  }
  const [, rawFrontmatter, body] = match
  const fm = parseFrontmatter(rawFrontmatter, opts.filePath)

  const id = readRequiredScalar(fm, 'draft-id', opts.filePath)
  const createdAt = readRequiredScalar(fm, 'created-at', opts.filePath)
  const title = readRequiredScalar(fm, 'title', opts.filePath)
  const topic = readRequiredScalar(fm, 'topic', opts.filePath)
  const confidenceRaw = readRequiredScalar(fm, 'confidence', opts.filePath)
  const confidence = Number(confidenceRaw)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AdrParseError(
      opts.filePath,
      `invalid confidence "${confidenceRaw}" — expected a number between 0 and 1`,
    )
  }
  const entities = readList(fm, 'entities') ?? []

  // Drafts are work-in-progress — body section-completeness is NOT enforced
  // here. The user can save a draft mid-edit (e.g., deleted Context to
  // rewrite it) and it must still appear in the review queue. The rule is
  // enforced at accept time by the writer, and the UI surfaces a warning +
  // disables Save / Accept when the body isn't yet valid.

  return {
    id,
    createdAt,
    title,
    topic: topic as AdrTopicValue,
    entities,
    madrBody: body.replace(/^\s+/, ''),
    confidence,
  }
}

export function serializeAdrDraft(draft: AdrDraft): string {
  const todayUtc = new Date().toISOString().slice(0, 10)
  const fm: string[] = [
    '---',
    'status: proposed',
    `date: ${todayUtc}`,
    `title: ${draft.title}`,
    `topic: ${draft.topic}`,
    `entities: ${formatList(draft.entities)}`,
    `confidence: ${draft.confidence}`,
    `draft-id: ${draft.id}`,
    `created-at: ${draft.createdAt}`,
    '---',
    '',
  ]
  // Body: the LLM-produced MADR body as-is. If the body doesn't already
  // include an H1 title, prepend one so the file reads cleanly.
  const hasH1 = /^#\s+/m.test(draft.madrBody)
  const bodyLines = hasH1 ? [draft.madrBody] : [`# ${draft.title}`, '', draft.madrBody]
  return [...fm, ...bodyLines].join('\n')
}

// ===========================================================================
// Living Fragments (M11) — parser + snapshot capture
// ===========================================================================
//
// Parses `adr-graph` / `adr-flow` fenced blocks out of a MADR body and
// captures a compact snapshot of the resolved subgraph / flow steps at
// accept time. The snapshot is persisted on `AdrIndexEntry.fragments[]`;
// the dashboard renders it next to the live view to show drift.

export interface ParsedFragment {
  kind: 'graph' | 'flow'
  locator: AdrGraphFragmentLocator | AdrFlowFragmentLocator
  /** Offset of the opening fence in the original body — used by the
   *  suggester to strip invalid blocks post-generation. */
  start: number
  /** Offset past the closing fence. */
  end: number
}

// Matches ```adr-graph\n…\n``` and ```adr-flow\n…\n``` as whole blocks.
// The `m` flag anchors ^ to line starts so the closing fence must be at
// column 0 (we don't treat indented fences as fragment blocks).
const FRAGMENT_FENCE_RE = /^```(adr-graph|adr-flow)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm

export function extractFragmentsFromBody(body: string): ParsedFragment[] {
  const fragments: ParsedFragment[] = []
  // Clone regex per call — /g state is stateful across invocations otherwise.
  const re = new RegExp(FRAGMENT_FENCE_RE.source, FRAGMENT_FENCE_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    const [full, lang, content] = match
    const start = match.index
    const end = start + full.length
    try {
      if (lang === 'adr-graph') {
        fragments.push({ kind: 'graph', locator: parseGraphLocator(content), start, end })
      } else {
        fragments.push({ kind: 'flow', locator: parseFlowLocator(content), start, end })
      }
    } catch (err) {
      // Lenient — malformed blocks are skipped (not captured), body stays
      // intact. The LLM occasionally emits almost-valid blocks; we'd rather
      // drop the block than the whole draft.
      console.warn(
        `[adr-store] skipping malformed ${lang} block: ${(err as Error).message}`,
      )
    }
  }
  return fragments
}

function parseFragmentLocatorFrontmatter(raw: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
    if (!m) continue // lenient — skip anything not `key: value`
    const [, key, value] = m
    out[key] = parseScalarOrList(value.trim())
  }
  return out
}

function parseGraphLocator(content: string): AdrGraphFragmentLocator {
  const fm = parseFragmentLocatorFrontmatter(content)
  const toList = (v: string | string[] | undefined): string[] | undefined =>
    v === undefined ? undefined : Array.isArray(v) ? v : [v]
  const showRaw = typeof fm.show === 'string' ? fm.show : undefined
  const show =
    showRaw === 'dependencies' || showRaw === 'modules' || showRaw === 'all'
      ? showRaw
      : undefined
  const locator: AdrGraphFragmentLocator = {
    services: toList(fm.services),
    modules: toList(fm.modules),
    show,
  }
  if ((locator.services?.length ?? 0) === 0 && (locator.modules?.length ?? 0) === 0) {
    throw new Error('adr-graph block must specify at least one service or module')
  }
  return locator
}

function parseFlowLocator(content: string): AdrFlowFragmentLocator {
  const fm = parseFragmentLocatorFrontmatter(content)
  const flowId = typeof fm.flowId === 'string' ? fm.flowId : undefined
  if (!flowId) throw new Error('adr-flow block missing required `flowId`')
  const asInt = (v: unknown): number | undefined => {
    if (typeof v !== 'string') return undefined
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    flowId,
    fromStep: asInt(fm.fromStep),
    toStep: asInt(fm.toStep),
  }
}

/**
 * Resolve a parsed fragment against a graph and capture a snapshot. Returns
 * `null` when no references resolve — caller (writer) treats the block as
 * unresolvable and doesn't persist a snapshot; the body keeps the fence.
 */
export function captureFragmentSnapshot(
  fragment: ParsedFragment,
  graph: Graph,
): FragmentSnapshot | null {
  return fragment.kind === 'graph'
    ? captureGraphSnapshot(fragment.locator as AdrGraphFragmentLocator, graph)
    : captureFlowSnapshot(fragment.locator as AdrFlowFragmentLocator, graph)
}

function captureGraphSnapshot(
  locator: AdrGraphFragmentLocator,
  graph: Graph,
): FragmentSnapshot | null {
  // Layer names per service id — computed once since we'll look it up
  // multiple times below.
  const layersByServiceId = new Map<string, string[]>()
  for (const layer of graph.layers ?? []) {
    const arr = layersByServiceId.get(layer.serviceId) ?? []
    if (!arr.includes(layer.layer)) arr.push(layer.layer)
    layersByServiceId.set(layer.serviceId, arr)
  }

  const nodes: GraphFragmentNode[] = []
  for (const ref of locator.services ?? []) {
    const svc = graph.services.find((s) => s.name === ref || s.id === ref)
    if (!svc) continue
    nodes.push({
      id: svc.id,
      name: svc.name,
      kind: 'service',
      serviceType: svc.type,
      framework: svc.framework,
      fileCount: svc.fileCount ?? 0,
      description: svc.description,
      layers: layersByServiceId.get(svc.id) ?? [],
      rootPath: svc.rootPath,
    })
  }
  for (const ref of locator.modules ?? []) {
    const mod = graph.modules.find((m) => m.name === ref || m.id === ref)
    if (!mod) continue
    nodes.push({
      id: mod.id,
      name: mod.name,
      kind: 'module',
      moduleKind: mod.kind,
      methodCount: mod.methodCount,
    })
  }
  if (nodes.length === 0) return null

  const serviceIds = new Set(nodes.filter((n) => n.kind === 'service').map((n) => n.id))
  const edges: GraphFragmentEdge[] = []
  for (const dep of graph.serviceDependencies) {
    if (serviceIds.has(dep.sourceServiceId) && serviceIds.has(dep.targetServiceId)) {
      const srcName =
        graph.services.find((s) => s.id === dep.sourceServiceId)?.name ?? dep.sourceServiceId
      const tgtName =
        graph.services.find((s) => s.id === dep.targetServiceId)?.name ?? dep.targetServiceId
      edges.push({
        source: srcName,
        target: tgtName,
        count: dep.dependencyCount ?? undefined,
        dependencyType: dep.dependencyType ?? undefined,
      })
    }
  }

  return {
    kind: 'graph',
    locator,
    capturedAt: new Date().toISOString(),
    nodes,
    edges,
    graphHash: hashSnapshotPayload({
      nodes: nodes.map((n) => [n.id, n.name, n.kind]).sort(),
      edges: edges.map((e) => [e.source, e.target, e.count ?? 0]).sort(),
    }),
  }
}

function captureFlowSnapshot(
  locator: AdrFlowFragmentLocator,
  graph: Graph,
): FragmentSnapshot | null {
  const flow = graph.flows.find((f) => f.id === locator.flowId || f.name === locator.flowId)
  if (!flow) return null

  let steps = flow.steps
  if (locator.fromStep != null) {
    const from = locator.fromStep
    steps = steps.filter((s) => s.stepOrder >= from)
  }
  if (locator.toStep != null) {
    const to = locator.toStep
    steps = steps.filter((s) => s.stepOrder <= to)
  }

  return {
    kind: 'flow',
    locator,
    capturedAt: new Date().toISOString(),
    flowName: flow.name,
    steps: steps.map((s) => ({
      stepOrder: s.stepOrder,
      sourceService: s.sourceService,
      sourceModule: s.sourceModule,
      targetService: s.targetService,
      targetModule: s.targetModule,
      targetMethod: s.targetMethod,
      stepType: s.stepType,
      isAsync: s.isAsync,
      dataDescription: s.dataDescription ?? null,
    })),
    graphHash: hashSnapshotPayload({
      flowName: flow.name,
      steps: steps.map((s) => [
        s.stepOrder,
        s.sourceService,
        s.sourceModule,
        s.targetService,
        s.targetModule,
        s.targetMethod,
        s.stepType,
      ]),
    }),
  }
}

/** Non-cryptographic hash — adequate for drift detection across analyses. */
function hashSnapshotPayload(payload: unknown): string {
  const s = JSON.stringify(payload)
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return h.toString(36)
}

// ===========================================================================
// Graph entity enumeration (shared by suggester + staleness check)
// ===========================================================================
//
// Permissive on purpose: includes both canonical IDs and display names for
// services/modules/databases. LLMs naming a module when they meant a service
// still validate; humans writing an ADR that refers to a service by name
// shouldn't break staleness just because the service ID is a UUID.

export function collectGraphEntityIds(graph: Graph): Set<string> {
  const set = new Set<string>()
  for (const svc of graph.services) {
    set.add(svc.id)
    set.add(svc.name)
  }
  for (const mod of graph.modules) {
    set.add(mod.id)
    set.add(mod.name)
  }
  for (const db of graph.databases) {
    set.add(db.id)
    set.add(db.name)
  }
  return set
}

// ===========================================================================
// Structural staleness refresh
// ===========================================================================
//
// After every full analyze, walk each ADR in the corpus and flag as stale
// when any of its `requiredEntities` is no longer present in the graph.
//
// STRUCTURAL only — entities must exist by ID or name. Intent-level
// staleness ("this ADR's decision is no longer honored by the code") is
// Phase 19.3 work.
//
// The MADR file on disk is NOT mutated. Staleness lives only on the
// parsed corpus record (`isStale`, `staleReasons`) so users can fix the
// underlying mismatch and the flag clears on next analyze.

export interface StalenessRefreshResult {
  /** Total accepted ADRs inspected. */
  inspected: number
  /** ADRs newly flagged stale on this pass. */
  newlyStale: AdrIndexEntry[]
  /** ADRs that went from stale → not stale on this pass. */
  clearedStale: AdrIndexEntry[]
}

export function refreshAdrStaleness(
  repoPath: string,
  graph: Graph,
): StalenessRefreshResult {
  const corpus = readAdrCorpus(repoPath)
  if (!corpus) {
    return { inspected: 0, newlyStale: [], clearedStale: [] }
  }

  const known = collectGraphEntityIds(graph)
  const newlyStale: AdrIndexEntry[] = []
  const clearedStale: AdrIndexEntry[] = []

  const nextAdrs = corpus.adrs.map((entry) => {
    // Only accepted/proposed ADRs can go stale. Superseded / deprecated
    // ones are archival — their graph-existence is irrelevant.
    if (entry.status === 'superseded' || entry.status === 'deprecated') {
      return stripStale(entry)
    }

    const missing = entry.requiredEntities.filter((e) => !known.has(e))
    // Fragment-driven reasons (M11). Drift alone (same nodes, new edges) is
    // NOT stale — the dashboard shows that visually. Only removal/renames
    // that eliminate a referenced node or flow flag stale.
    const fragmentReasons: string[] = []
    for (const fragment of entry.fragments ?? []) {
      if (fragment.kind === 'graph') {
        for (const node of fragment.nodes) {
          if (!known.has(node.id) && !known.has(node.name)) {
            fragmentReasons.push(`fragment references removed entity: ${node.name}`)
          }
        }
      } else {
        const stillExists = graph.flows.some(
          (f) => f.id === fragment.locator.flowId || f.name === fragment.locator.flowId,
        )
        if (!stillExists) {
          fragmentReasons.push(`fragment references removed flow: ${fragment.locator.flowId}`)
        }
      }
    }
    const allReasons = [
      ...missing.map((e) => `missing entity: ${e}`),
      ...fragmentReasons,
    ]
    const isNowStale = allReasons.length > 0
    const wasStale = entry.isStale === true

    if (isNowStale) {
      const next: AdrIndexEntry = {
        ...entry,
        isStale: true,
        staleReasons: allReasons,
      }
      if (!wasStale) newlyStale.push(next)
      return next
    }

    if (wasStale) {
      clearedStale.push(entry)
    }
    return stripStale(entry)
  })

  writeAdrCorpus(repoPath, {
    generatedAt: new Date().toISOString(),
    adrs: nextAdrs,
  })

  return { inspected: corpus.adrs.length, newlyStale, clearedStale }
}

function stripStale(entry: AdrIndexEntry): AdrIndexEntry {
  if (!entry.isStale && !entry.staleReasons) return entry
  const { isStale: _drop1, staleReasons: _drop2, ...rest } = entry
  return rest
}
