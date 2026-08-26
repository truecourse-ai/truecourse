/**
 * THE SCAN SESSIONS' READ TOOLS — every one of them read-only and bounded.
 * A scan session reads the doc universe the run
 * discovered; it writes nothing. Every write — skips, tags, areas, overlap
 * flags — happens in the run's FOLD (`run.ts`), after the outcome, so a
 * session that dies mid-budget strands no half-curated state.
 *
 * The validator tools (`check_settlement` in settle-areas.ts, `check_findings`
 * in overlap.ts) live beside the schemas they validate; this module holds the
 * data tools the session kinds share, plus the one cache-key convention every
 * kind builds with ({@link scanCacheKey}).
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defineSessionTool, type SessionTool } from '@truecourse/agent-loop'
import {
  docBody,
  headingOutline,
  leadText,
  sectionText,
  type DocCandidate,
} from '@truecourse/spec-consolidator'
import { parseHeadings, planDocChunks } from '@truecourse/shared'

/** Caps — a tool result is context, and context is the budget. */
const MAX_DOCS_LISTED = 200
/** One chunk of a doc a tool (or the briefing) shows per call. The SAME size
 *  the curate briefing chunks with, so "chunk 2" means one thing everywhere. */
export const DOC_CHUNK_CHARS = 16_000

/**
 * One scan cache key: sha256 over ordered parts joined with `::`. Every scan
 * session kind keys through this, and every key builder takes an optional
 * `extraParts` tail — that is where step 6's orchestrator `instructions`
 * fingerprint will be APPENDED later without re-deriving anything else.
 */
export function scanCacheKey(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('::')).digest('hex')
}

/**
 * The fingerprint of the orchestrator's standing `instructions` (step 6) —
 * `sha256(instructions.join('\n'))`, APPENDED (via each key builder's
 * `extraParts` tail) to EVERY scan session's cache key. Editing an instruction
 * therefore re-scans the corpus — deliberate: an instruction changes every
 * judgment, and the pre-flight estimate keys the same way so it says so.
 */
export function instructionsFingerprint(instructions: readonly string[]): string {
  return createHash('sha256').update(instructions.join('\n')).digest('hex')
}

/**
 * The standing-instructions briefing block every scan session opens with (empty
 * instructions render nothing). One renderer so the three session kinds cannot
 * phrase the same authority differently.
 */
export function instructionsBriefingBlock(instructions: readonly string[]): string[] {
  if (instructions.length === 0) return []
  return [
    'STANDING SCAN INSTRUCTIONS (user/orchestrator authority — they bind every judgment below):',
    ...instructions.map((line) => `  - ${line}`),
    '',
  ]
}

/** The doc universe as the tools see it: every discovered doc, by ref. */
export interface ScanDocUniverse {
  byPath: ReadonlyMap<string, DocCandidate>
  ordered: readonly DocCandidate[]
}

export function buildScanUniverse(docs: readonly DocCandidate[]): ScanDocUniverse {
  return { byPath: new Map(docs.map((d) => [d.path, d])), ordered: docs }
}

/** A doc's display title: its first heading, else its basename. */
export function docTitle(doc: DocCandidate): string {
  const headings = parseHeadings(doc.preview.split('\n'))
  if (headings.length > 0) return headings[0].text
  const base = doc.path.split('/').pop() ?? doc.path
  return base
}

/** Render one chunk of a doc, with an honest chunk header. */
function renderChunk(doc: DocCandidate, chunk: number): { content: string; isError?: boolean } {
  const chunks = planDocChunks(doc.path, docBody(doc), DOC_CHUNK_CHARS)
  if (chunk > chunks.length) {
    return {
      content: `\`${doc.path}\` has ${chunks.length} chunk(s) — chunk ${chunk} is past the end.`,
      isError: true,
    }
  }
  const c = chunks[chunk - 1]
  const head =
    chunks.length > 1 ? `--- ${doc.path} (chunk ${c.index}/${c.total}) ---` : `--- ${doc.path} ---`
  return { content: [head, c.text, `--- end ---`].join('\n') }
}

/**
 * `read_doc` — any universe doc, by ref, one chunk at a time. Steps 3 and 4
 * share it: a curation session opens ANOTHER doc only to resolve an explicit
 * reference/deferral; the settle session reads samples of a label's docs.
 */
export function readDocTool(universe: ScanDocUniverse): SessionTool {
  return defineSessionTool({
    name: 'read_doc',
    description:
      'Read any doc of the universe by its repo-relative ref. Long docs come one chunk at a time — pass `chunk` to page (1-based).',
    kind: 'read-doc',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        ref: z.string().min(1).describe('Repo-relative doc ref, as listed by `list_docs`.'),
        chunk: z.number().int().positive().optional().describe('Chunk number (default 1).'),
      })
      .strict(),
    async execute(args) {
      const doc = universe.byPath.get(args.ref)
      if (!doc) return { content: `No doc \`${args.ref}\` in the universe — \`list_docs\` shows what exists.`, isError: true }
      return renderChunk(doc, args.chunk ?? 1)
    },
  })
}

/**
 * `read_chunk` — the session's OWN doc, paged. The briefing already carries
 * chunk 1; this fetches the rest under the same chunk plan.
 */
export function readChunkTool(doc: DocCandidate): SessionTool {
  return defineSessionTool({
    name: 'read_chunk',
    description: 'Read another chunk of THE doc you are curating (the briefing carried chunk 1).',
    kind: 'read-own-doc-chunk',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({ chunk: z.number().int().positive().describe('Chunk number (2 and up — 1 is in the briefing).') })
      .strict(),
    async execute(args) {
      return renderChunk(doc, args.chunk)
    },
  })
}

/**
 * `corpus_vocab` — the product/concern labels the RUN has folded so far. Live
 * on purpose: a session that is about to mint a new label looks here first and
 * reuses the peer's wording, which is what keeps one concept in one area.
 */
export function corpusVocabTool(
  liveVocab: () => { products: readonly string[]; concerns: readonly string[] },
): SessionTool {
  return defineSessionTool({
    name: 'corpus_vocab',
    description:
      'The product and concern labels this scan has already assigned to other docs. Call it BEFORE minting a new label — reuse an existing label that names the same thing.',
    kind: 'corpus-vocab',
    readOnly: true,
    destructive: false,
    inputSchema: z.object({}).strict(),
    async execute() {
      const { products, concerns } = liveVocab()
      if (products.length === 0 && concerns.length === 0) {
        return { content: 'No labels assigned yet — this doc is among the first folded. Name what you see.' }
      }
      return {
        content: [
          `products (${products.length}): ${products.join(', ') || '(only core so far)'}`,
          `concerns (${concerns.length}): ${concerns.join(', ') || '(none yet)'}`,
        ].join('\n'),
      }
    },
  })
}

/** `list_docs` — paths + titles only, optionally under one directory prefix. */
export function listDocsTool(universe: ScanDocUniverse): SessionTool {
  return defineSessionTool({
    name: 'list_docs',
    description:
      'List the docs of the universe — path and title only. Narrow with `dir` (a path prefix) when resolving a reference whose exact path you do not know.',
    kind: 'list-docs',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({ dir: z.string().min(1).optional().describe('Keep only refs under this path prefix, e.g. `docs/api`.') })
      .strict(),
    async execute(args) {
      const prefix = args.dir?.replace(/\/+$/, '')
      const matched = universe.ordered.filter(
        (d) => !prefix || d.path === prefix || d.path.startsWith(`${prefix}/`),
      )
      if (matched.length === 0) {
        return { content: prefix ? `No doc under \`${prefix}/\`.` : 'The universe is empty.', isError: prefix !== undefined }
      }
      const shown = matched.slice(0, MAX_DOCS_LISTED)
      const rows = shown.map((d) => `${d.path}  ·  ${docTitle(d)}`)
      const tail =
        matched.length > shown.length ? `\n… ${matched.length - shown.length} more — narrow with \`dir\`.` : ''
      return { content: rows.join('\n') + tail }
    },
  })
}

/**
 * `docs_with_label` — the docs carrying one canonical product/concern label
 * (settle-areas). The label index is live state the run maintains. The settle
 * briefing already carries the WHOLE map, so this is the ESCAPE HATCH for the
 * one label whose briefed list was cut short (an oversized subdivision
 * candidate), not the way to read the map.
 */
export function docsWithLabelTool(
  universe: ScanDocUniverse,
  docsByLabel: () => ReadonlyMap<string, readonly string[]>,
): SessionTool {
  return defineSessionTool({
    name: 'docs_with_label',
    description:
      'The FULL doc list of one canonical product or concern label (path + title). The briefing already lists every label with its docs — call this only for a label whose briefed list was cut short, e.g. before assigning every doc of an oversized label you are subdividing.',
    kind: 'docs-with-label',
    readOnly: true,
    destructive: false,
    inputSchema: z.object({ label: z.string().min(1).describe('A canonical label from the briefing.') }).strict(),
    async execute(args) {
      const byLabel = docsByLabel()
      const refs = byLabel.get(args.label)
      if (!refs || refs.length === 0) {
        const known = [...byLabel.keys()].sort()
        return {
          content: `No doc carries \`${args.label}\`. Known labels: ${known.slice(0, 60).join(', ')}${known.length > 60 ? ', …' : ''}`,
          isError: true,
        }
      }
      const shown = refs.slice(0, MAX_DOCS_LISTED)
      const rows = shown.map((ref) => {
        const doc = universe.byPath.get(ref)
        return doc ? `${ref}  ·  ${docTitle(doc)}` : ref
      })
      const tail = refs.length > shown.length ? `\n… ${refs.length - shown.length} more.` : ''
      return { content: rows.join('\n') + tail }
    },
  })
}

/**
 * `read_section` — one section of a doc, by heading (or the lead for `null`).
 * The overlap session's main read: the briefing carries outlines, and the
 * session opens only the sections where topics collide. The fold counts calls
 * to THIS tool off the transcript as the area's `sectionsOpened`.
 */
export function readSectionTool(universe: ScanDocUniverse): SessionTool {
  return defineSessionTool({
    name: 'read_section',
    description:
      'Read one SECTION of a doc: the text under one heading (subsections included), or the lead when `heading` is null. Headings come from the outlines in the briefing — copy them verbatim.',
    kind: 'read-doc-section',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        doc: z.string().min(1).describe('The doc ref, as shown in the briefing.'),
        heading: z
          .string()
          .nullable()
          .describe('One of the doc\'s headings, verbatim — or null for the lead (text above the first heading).'),
      })
      .strict(),
    async execute(args) {
      const doc = universe.byPath.get(args.doc)
      if (!doc) return { content: `No doc \`${args.doc}\` in the universe.`, isError: true }
      const body = docBody(doc)
      if (args.heading === null) {
        const lead = leadText(body)
        return lead.trim()
          ? { content: [`--- ${args.doc} · lead ---`, lead, '--- end ---'].join('\n') }
          : { content: `\`${args.doc}\` has no lead — it opens straight with a heading. Its outline:\n${headingOutline(body)}`, isError: true }
      }
      const text = sectionText(body, args.heading)
      if (text === null) {
        return {
          content: `\`${args.doc}\` has no section \`${args.heading}\`. Its outline:\n${headingOutline(body)}`,
          isError: true,
        }
      }
      return { content: [`--- ${args.doc} · ${args.heading} ---`, text, '--- end ---'].join('\n') }
    },
  })
}

/** `read_doc_chunk` — a whole-doc page for the overlap session (a doc whose
 *  structure the outline does not carry, e.g. heading-free prose). */
export function readDocChunkTool(universe: ScanDocUniverse): SessionTool {
  return defineSessionTool({
    name: 'read_doc_chunk',
    description:
      'Read one chunk of a whole doc (1-based). Use it for a doc whose outline is too thin to pick sections from; prefer `read_section` everywhere else.',
    kind: 'read-doc-chunk',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        doc: z.string().min(1).describe('The doc ref, as shown in the briefing.'),
        chunk: z.number().int().positive().describe('Chunk number, 1-based.'),
      })
      .strict(),
    async execute(args) {
      const doc = universe.byPath.get(args.doc)
      if (!doc) return { content: `No doc \`${args.doc}\` in the universe.`, isError: true }
      return renderChunk(doc, args.chunk)
    },
  })
}
