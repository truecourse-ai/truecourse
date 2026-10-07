/**
 * THE GUARD-GENERATE SESSIONS' READ TOOLS — every one
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
import { defineToolSpec, type SessionTool } from '@truecourse/agent-loop'
import { parseDocTree, planWindows, windowText } from '@truecourse/shared'
import { isOpenApiDoc } from '@truecourse/shared/openapi'
import type { GuardDoc, SectionInput } from '@truecourse/guard-generator'

/**
 * The character budget of one window of a doc a tool (or the briefing) shows
 * per call — the same size the scan sessions page with, so "window 2" means
 * one thing everywhere.
 */
export const GUARD_DOC_WINDOW_CHARS = 16_000

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
 * The doc's paging plan: the shared doc tree's windows. An OpenAPI doc has no
 * sentences to window (its sections ARE its operations), so it pages per
 * OPERATION SECTION instead, with the full outline still the snapping set.
 */
function docPages(doc: GuardDoc): string[] {
  if (isOpenApiDoc(doc.doc, doc.content) && doc.sections.length > 1) {
    return doc.sections.map((s) => s.fullText)
  }
  const tree = parseDocTree(doc.doc, doc.content)
  return planWindows(tree, { maxChars: GUARD_DOC_WINDOW_CHARS }).map((w) => windowText(tree, w))
}

/** Render one window (page) of a doc, with an honest window header. */
export function renderDocWindow(doc: GuardDoc, window: number): { content: string; isError?: boolean } {
  const pages = docPages(doc)
  if (window > pages.length) {
    return {
      content: `\`${doc.doc}\` has ${pages.length} window(s) — window ${window} is past the end.`,
      isError: true,
    }
  }
  const head = pages.length > 1 ? `--- ${doc.doc} (window ${window}/${pages.length}) ---` : `--- ${doc.doc} ---`
  return { content: [head, pages[window - 1], '--- end ---'].join('\n') }
}

/** How many windows (pages) a doc's briefing pages through. */
export function docWindowCount(doc: GuardDoc): number {
  return docPages(doc).length
}

const READ_OWN_SECTION = defineToolSpec({
  name: 'read_section',
  description:
    'Read one SECTION of the doc you are extracting: the text under one heading (subsections included). Pass an anchor or heading from the outline, verbatim.',
  kind: 'read-own-doc-section',
  readOnly: true,
  destructive: false,
  inputSchema: z
    .object({ heading: z.string().min(1).describe('An anchor (or heading) from the outline, verbatim.') })
    .strict(),
})

/**
 * `read_section` — one section of THE doc a session owns, by anchor or heading
 * (the extract session's main read beyond its briefed first window; OpenAPI docs
 * resolve per operation, since their sections ARE the operations).
 */
export function readOwnSectionTool(doc: GuardDoc): SessionTool {
  return READ_OWN_SECTION.bind({
    async execute(args) {
      const section = resolveSection(doc, args.heading)
      if (!section) return noSectionError(doc, args.heading)
      return { content: renderSection(doc, section) }
    },
  })
}

const READ_OWN_WINDOW = defineToolSpec({
  name: 'read_window',
  description: 'Read another window of THE doc you are extracting (the briefing carried window 1).',
  kind: 'read-own-doc-window',
  readOnly: true,
  destructive: false,
  inputSchema: z
    .object({ window: z.number().int().positive().describe('Window number (2 and up — 1 is in the briefing).') })
    .strict(),
})

/** `read_window` — the session's OWN doc, paged (the briefing carried window 1). */
export function readOwnWindowTool(doc: GuardDoc): SessionTool {
  return READ_OWN_WINDOW.bind({
    async execute(args) {
      return renderDocWindow(doc, args.window)
    },
  })
}

const READ_REFERENCED_DOC = defineToolSpec({
  name: 'read_referenced_doc',
  description:
    'Read ANOTHER spec doc of this run, by its repo-relative ref — only to resolve an explicit reference your doc makes, never to browse. Pass `heading` for one section, omit it for the opening window.',
  kind: 'read-referenced-doc',
  readOnly: true,
  destructive: false,
  inputSchema: z
    .object({
      ref: z.string().min(1).describe('Repo-relative doc ref, as the reference names it.'),
      heading: z.string().min(1).optional().describe('An anchor or heading of that doc, verbatim.'),
    })
    .strict(),
})

/**
 * `read_referenced_doc` — ANOTHER doc of the run's universe, opened only to
 * resolve an explicit reference the own doc makes ("see docs/auth.md"). One
 * section when `heading` is given, window 1 otherwise.
 */
export function readReferencedDocTool(universe: GuardDocUniverse): SessionTool {
  return READ_REFERENCED_DOC.bind({
    async execute(args) {
      const doc = universe.byPath.get(args.ref)
      if (!doc) {
        const known = universe.ordered.map((d) => d.doc)
        return {
          content: `No doc \`${args.ref}\` in this run's universe. Known docs:\n${known.join('\n')}`,
          isError: true,
        }
      }
      if (args.heading === undefined) return renderDocWindow(doc, 1)
      const section = resolveSection(doc, args.heading)
      if (!section) return noSectionError(doc, args.heading)
      return { content: renderSection(doc, section) }
    },
  })
}

const READ_UNIVERSE_SECTION = defineToolSpec({
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
})

/**
 * `read_section` (flows flavor) — one section of ANY universe doc, addressed
 * `{doc, heading}`: the synthesis session's read for a claim whose context the
 * outline alone does not settle.
 */
export function readUniverseSectionTool(universe: GuardDocUniverse): SessionTool {
  return READ_UNIVERSE_SECTION.bind({
    async execute(args) {
      const doc = universe.byPath.get(args.doc)
      if (!doc) return { content: `No doc \`${args.doc}\` in this run's universe.`, isError: true }
      const section = resolveSection(doc, args.heading)
      if (!section) return noSectionError(doc, args.heading)
      return { content: renderSection(doc, section) }
    },
  })
}
