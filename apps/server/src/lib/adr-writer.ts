import fs from 'node:fs'
import path from 'node:path'
import type {
  Adr,
  AdrDraft,
  AdrIndexEntry,
  AdrStatus,
  FragmentSnapshot,
} from '@truecourse/shared'
import { log } from './logger.js'
import {
  captureFragmentSnapshot,
  deleteAdrDraft,
  extractFragmentsFromBody,
  parseAdr,
  readAdrCorpus,
  serializeAdr,
  toAdrIndexEntry,
  writeAdrCorpus,
} from './adr-store.js'
import { readLatest } from './analysis-store.js'
import { getDefaultAdrOutputDir } from '../config/paths.js'

// ---------------------------------------------------------------------------
// MADR writer — promotes drafts to accepted ADR files on disk
// ---------------------------------------------------------------------------
//
// Two-step accept:
//   1. serialize + write the MADR markdown to <adrDir>/ADR-NNNN-<slug>.md
//   2. parse it back, add to .truecourse/adrs.json, delete the draft file
//
// Step 2 is what ensures the corpus index is self-consistent with disk
// — we parse what we just wrote rather than constructing the Adr record
// from the draft alone.

export interface AcceptAdrDraftOptions {
  /** Repo root. Default ADR output dir is `docs/adr/`; overridable. */
  repoPath: string
  /** The draft to promote. */
  draft: AdrDraft
  /** Override the default output dir (defaults to `<repoPath>/docs/adr`). */
  outputDir?: string
  /** Override the accepted ADR status. Defaults to `accepted`. */
  status?: AdrStatus
  /** Override the date shown in the MADR file. Defaults to today (UTC YYYY-MM-DD). */
  date?: string
}

export interface AcceptAdrDraftResult {
  /** The parsed, filed ADR record now in the corpus. */
  adr: Adr
  /** Absolute path of the MADR file that was written. */
  filePath: string
}

export async function acceptAdrDraft(
  opts: AcceptAdrDraftOptions,
): Promise<AcceptAdrDraftResult> {
  const outputDir = opts.outputDir ?? getDefaultAdrOutputDir(opts.repoPath)
  fs.mkdirSync(outputDir, { recursive: true })

  const number = nextAdrNumber(outputDir)
  const id = formatAdrId(number)
  const slug = slugify(opts.draft.title)
  const filename = `${id}-${slug}.md`
  const filePath = path.join(outputDir, filename)

  // Build the Adr record from the draft + assigned number, then serialize.
  // The LLM-returned MADR body may be structurally correct — we could write
  // it directly — but we rebuild from the structured draft so the on-disk
  // file always matches our schema exactly (frontmatter order, section
  // headings, link metadata).

  const status: AdrStatus = opts.status ?? 'accepted'
  if (status === 'stale') {
    throw new Error('`stale` is a computed status and cannot be written to disk')
  }

  const sections = extractSectionsFromMadrBody(opts.draft.madrBody)

  const adr: Adr = {
    id,
    number,
    title: opts.draft.title,
    status,
    date: opts.date ?? todayIsoDate(),
    path: path.relative(opts.repoPath, filePath),
    sections,
    linkedNodeIds: [...opts.draft.entities],
    requiredEntities: [...opts.draft.entities],
    sourceDraftId: opts.draft.id,
  }

  const madrText = serializeAdr(adr)
  fs.writeFileSync(filePath, madrText, 'utf-8')

  // Round-trip through the parser so any shape mismatch fails loud here
  // rather than on the next analyze. The path stored on the parsed record
  // matches what we wrote.
  const parsed = parseAdr({ filePath: adr.path, source: madrText })

  // Capture Living-Fragments snapshots (M11). For each `adr-graph` /
  // `adr-flow` block in the body, resolve against the current graph and
  // freeze a compact snapshot on the index entry. Unresolvable blocks are
  // silently skipped — the block stays in the body so a plain reader sees
  // it, but no snapshot is persisted (dashboard will fall back to the
  // raw fence text for those).
  const latest = readLatest(opts.repoPath)
  const parsedFragments = extractFragmentsFromBody(madrText)
  const snapshots: FragmentSnapshot[] = latest
    ? parsedFragments
        .map((f) => captureFragmentSnapshot(f, latest.graph))
        .filter((s): s is FragmentSnapshot => s !== null)
    : []

  const indexEntry: AdrIndexEntry = {
    ...toAdrIndexEntry(parsed),
    ...(snapshots.length > 0 ? { fragments: snapshots } : {}),
  }

  // Upsert into corpus index — metadata only. The full MADR body lives in
  // the .md file we just wrote; `adrs.json` holds only the index entry so
  // it stays free of escaped-markdown body strings.
  const corpus = readAdrCorpus(opts.repoPath) ?? {
    generatedAt: new Date().toISOString(),
    adrs: [],
  }
  const without = corpus.adrs.filter((a) => a.id !== parsed.id)
  writeAdrCorpus(opts.repoPath, {
    generatedAt: new Date().toISOString(),
    adrs: [...without, indexEntry],
  })

  // Remove the now-accepted draft from the review queue
  deleteAdrDraft(opts.repoPath, opts.draft.id)

  log.info(`[adr-writer] accepted draft ${opts.draft.id} → ${filename}`)

  return { adr: parsed, filePath }
}

// ---------------------------------------------------------------------------
// Numbering: max existing ADR-NNNN-* + 1
// ---------------------------------------------------------------------------

const ADR_FILE_RE = /^ADR-(\d{4,})-.*\.md$/

export function nextAdrNumber(outputDir: string): number {
  if (!fs.existsSync(outputDir)) return 1
  let max = 0
  for (const name of fs.readdirSync(outputDir)) {
    const m = ADR_FILE_RE.exec(name)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

export function formatAdrId(number: number): string {
  return `ADR-${String(number).padStart(4, '0')}`
}

// ---------------------------------------------------------------------------
// Slugify: turn a title into a filename-safe kebab segment
// ---------------------------------------------------------------------------

export function slugify(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')     // drop punctuation
    .trim()
    .replace(/\s+/g, '-')         // spaces → hyphens
    .replace(/-+/g, '-')          // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')      // trim leading/trailing hyphens
  return cleaned || 'adr'
}

// ---------------------------------------------------------------------------
// Section extraction from LLM-generated MADR body
// ---------------------------------------------------------------------------
//
// The LLM returns a full MADR body including the `# ADR-XXXX: Title` heading,
// `## Context`, `## Decision`, `## Consequences`. We pull the three sections
// out so `serializeAdr` can rebuild the file in canonical form.

export function extractSectionsFromMadrBody(body: string): Adr['sections'] {
  const sections = new Map<string, string[]>()
  let current: string | null = null
  for (const line of body.split('\n')) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line)
    if (h2) {
      current = h2[1].toLowerCase().trim()
      sections.set(current, [])
      continue
    }
    if (current) sections.get(current)!.push(line)
  }

  const context = (sections.get('context') ?? []).join('\n').trim()
  const decision = (sections.get('decision') ?? []).join('\n').trim()
  const consequences = (sections.get('consequences') ?? []).join('\n').trim()

  if (!context || !decision || !consequences) {
    throw new Error(
      `[adr-writer] LLM draft missing required section(s). ` +
        `context=${!!context}, decision=${!!decision}, consequences=${!!consequences}`,
    )
  }

  return { context, decision, consequences }
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}
