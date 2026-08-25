/**
 * THE GUARD-GENERATE SESSIONS' READ TOOLS (plan 04 steps 15 + 16) — every one
 * read-only and bounded. A generate session reads the run's doc universe (the
 * `GuardDoc`s the deterministic plan collected — full text plus the live
 * section index); it writes nothing. Every write happens in the run's fold,
 * after the outcomes, so a session that dies mid-budget strands no half-read
 * state.
 *
 * The validator tools (`check_claims` in extract.ts, `check_flows` in
 * flows.ts) live beside the session defs they gate; this module holds the data
 * tools the two kinds share, plus the doc-universe view they read through.
 */

import { z } from 'zod'
import { defineSessionTool, type SessionTool } from '@truecourse/agent-loop'
import { planDocChunks } from '@truecourse/shared'
import { isOpenApiDoc } from '@truecourse/shared/openapi'
import type { GuardDoc, SectionInput } from '@truecourse/guard-generator'

/**
 * One chunk of a doc a tool (or the briefing) shows per call — the same size
 * the scan sessions chunk with, so "chunk 2" means one thing everywhere.
 */
export const GUARD_DOC_CHUNK_CHARS = 16_000

/** The run's doc universe as the tools see it: every planned doc, by ref. */
export interface GuardDocUniverse {
  byPath: ReadonlyMap<string, GuardDoc>
  ordered: readonly GuardDoc[]
}

export function buildGuardDocUniverse(docs: readonly GuardDoc[]): GuardDocUniverse {
  return { byPath: new Map(docs.map((d) => [d.doc, d])), ordered: docs }
}

/** A doc's compact outline: one `anchor — heading` line per section. */
export function docOutlineLines(doc: GuardDoc): string[] {
  return doc.sections.map((s) => `${s.anchor} — ${s.headingText}`)
}

/**
 * Resolve a heading reference against a doc's live section index. Forgiving on
 * purpose (the model quotes what the briefing showed): exact anchor first, then
 * case-insensitive heading text, then case-insensitive anchor leaf — each only
 * when UNIQUE, so a loose reference is never bound to the wrong section.
 */
export function resolveSection(doc: GuardDoc, heading: string): SectionInput | null {
  const wanted = heading.trim()
  const exact = doc.sections.find((s) => s.anchor === wanted)
  if (exact) return exact
  const lower = wanted.toLowerCase()
  const byText = doc.sections.filter((s) => s.headingText.trim().toLowerCase() === lower)
  if (byText.length === 1) return byText[0]
  const byLeaf = doc.sections.filter((s) => (s.anchor.split('/').pop() ?? '').toLowerCase() === lower)
  if (byLeaf.length === 1) return byLeaf[0]
  return null
}

/** Render one section, heading path included, with honest fences. */
function renderSection(doc: GuardDoc, section: SectionInput): string {
  return [`--- ${doc.doc} · ${section.anchor} ---`, section.fullText, '--- end ---'].join('\n')
}

/** The "no such section" error, carrying the outline so one turn fixes it. */
function noSectionError(doc: GuardDoc, heading: string): { content: string; isError: true } {
  return {
    content: `\`${doc.doc}\` has no section \`${heading}\`. Its outline:\n${docOutlineLines(doc).join('\n')}`,
    isError: true,
  }
}

/**
 * The doc's paging plan. Markdown pages through the shared heading-aware
 * chunker; an OpenAPI doc is not markdown (the chunker would return ONE
 * potentially huge slice), so it pages per OPERATION SECTION instead —
 * mirroring the one-shot extract's `planViews` split, with the full outline
 * still the snapping set.
 */
function docPages(doc: GuardDoc): { text: string }[] {
  if (isOpenApiDoc(doc.doc, doc.content) && doc.sections.length > 1) {
    return doc.sections.map((s) => ({ text: s.fullText }))
  }
  return planDocChunks(doc.doc, doc.content, GUARD_DOC_CHUNK_CHARS).map((c) => ({ text: c.text }))
}

/** Render one chunk (page) of a doc, with an honest chunk header. */
export function renderDocChunk(doc: GuardDoc, chunk: number): { content: string; isError?: boolean } {
  const pages = docPages(doc)
  if (chunk > pages.length) {
    return {
      content: `\`${doc.doc}\` has ${pages.length} chunk(s) — chunk ${chunk} is past the end.`,
      isError: true,
    }
  }
  const head = pages.length > 1 ? `--- ${doc.doc} (chunk ${chunk}/${pages.length}) ---` : `--- ${doc.doc} ---`
  return { content: [head, pages[chunk - 1].text, '--- end ---'].join('\n') }
}

/** How many chunks (pages) a doc's briefing pages through. */
export function docChunkCount(doc: GuardDoc): number {
  return docPages(doc).length
}

/**
 * `read_section` — one section of THE doc a session owns, by anchor or heading
 * (the extract session's main read beyond its briefed first chunk; OpenAPI docs
 * resolve per operation, since their sections ARE the operations).
 */
export function readOwnSectionTool(doc: GuardDoc): SessionTool {
  return defineSessionTool({
    name: 'read_section',
    description:
      'Read one SECTION of the doc you are extracting: the text under one heading (subsections included). Pass an anchor or heading from the outline, verbatim.',
    kind: 'read-own-doc-section',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({ heading: z.string().min(1).describe('An anchor (or heading) from the outline, verbatim.') })
      .strict(),
    async execute(args) {
      const section = resolveSection(doc, args.heading)
      if (!section) return noSectionError(doc, args.heading)
      return { content: renderSection(doc, section) }
    },
  })
}

/** `read_chunk` — the session's OWN doc, paged (the briefing carried chunk 1). */
export function readOwnChunkTool(doc: GuardDoc): SessionTool {
  return defineSessionTool({
    name: 'read_chunk',
    description: 'Read another chunk of THE doc you are extracting (the briefing carried chunk 1).',
    kind: 'read-own-doc-chunk',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({ chunk: z.number().int().positive().describe('Chunk number (2 and up — 1 is in the briefing).') })
      .strict(),
    async execute(args) {
      return renderDocChunk(doc, args.chunk)
    },
  })
}

/**
 * `read_referenced_doc` — ANOTHER doc of the run's universe, opened only to
 * resolve an explicit reference the own doc makes ("see docs/auth.md"). One
 * section when `heading` is given, chunk 1 otherwise.
 */
export function readReferencedDocTool(universe: GuardDocUniverse): SessionTool {
  return defineSessionTool({
    name: 'read_referenced_doc',
    description:
      'Read ANOTHER spec doc of this run, by its repo-relative ref — only to resolve an explicit reference your doc makes, never to browse. Pass `heading` for one section, omit it for the opening chunk.',
    kind: 'read-referenced-doc',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        ref: z.string().min(1).describe('Repo-relative doc ref, as the reference names it.'),
        heading: z.string().min(1).optional().describe('An anchor or heading of that doc, verbatim.'),
      })
      .strict(),
    async execute(args) {
      const doc = universe.byPath.get(args.ref)
      if (!doc) {
        const known = universe.ordered.map((d) => d.doc)
        return {
          content: `No doc \`${args.ref}\` in this run's universe. Known docs:\n${known.join('\n')}`,
          isError: true,
        }
      }
      if (args.heading === undefined) return renderDocChunk(doc, 1)
      const section = resolveSection(doc, args.heading)
      if (!section) return noSectionError(doc, args.heading)
      return { content: renderSection(doc, section) }
    },
  })
}

/**
 * `read_section` (flows flavor) — one section of ANY universe doc, addressed
 * `{doc, heading}`: the synthesis session's read for a claim whose context the
 * outline alone does not settle.
 */
export function readUniverseSectionTool(universe: GuardDocUniverse): SessionTool {
  return defineSessionTool({
    name: 'read_section',
    description:
      "Read one SECTION of one of the area's docs: the text under one heading (subsections included). Anchors come from the outlines in the briefing — copy them verbatim.",
    kind: 'read-doc-section',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        doc: z.string().min(1).describe('The doc ref, as shown in the briefing.'),
        heading: z.string().min(1).describe('An anchor (or heading) of that doc, verbatim.'),
      })
      .strict(),
    async execute(args) {
      const doc = universe.byPath.get(args.doc)
      if (!doc) return { content: `No doc \`${args.doc}\` in this run's universe.`, isError: true }
      const section = resolveSection(doc, args.heading)
      if (!section) return noSectionError(doc, args.heading)
      return { content: renderSection(doc, section) }
    },
  })
}
