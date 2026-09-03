/**
 * Deterministic, LLM-free section derivation over a spec document — the runner
 * needs it to check each scenario's binding against the live doc before it
 * executes, and the generator will import the same functions to author bindings.
 *
 * A section is the binding unit. It is a heading plus its body up to the next
 * heading of the SAME OR HIGHER level, so a parent section's text includes its
 * descendant subsections. Its identity is an `anchor` (the slugified heading
 * path, parent/child chain) plus a `fingerprint` (a hash of the normalized
 * section text). Non-markdown docs collapse to a single whole-document section.
 *
 * A markdown doc's LEAD REGION — everything before its first heading, frontmatter
 * included — is a section too, named by the doc's frontmatter title (see
 * {@link leadSection}). Published docs put their title in frontmatter and state
 * real behavior before the first `##`, and text that belongs to no section is
 * text nothing can bind to.
 *
 * The slug helper is a small, self-contained duplicate of the heading-slug
 * convention used elsewhere in the codebase (spec-consolidator's overlap
 * widening): strip inline emphasis/code markers, lowercase, fold non-alphanumeric
 * runs to single hyphens, trim. Kept local so this module stays dependency-lean.
 */

import path from 'node:path'
import crypto from 'node:crypto'
import { isMarkdownDoc, parseHeadings, type RawHeading } from '@truecourse/shared'
import { isOpenApiDoc, deriveOpenApiSections, type RefResolutionContext } from '@truecourse/shared/openapi'

// The heading scan, markdown check, and top-level section splitter live in
// @truecourse/shared (doc-chunks) — the one splitting mechanism shared with the
// guard generator's views and spec-scan's overlap windows. Re-exported here so
// this module remains their canonical import site for runner consumers.
export { isMarkdownDoc, splitTopLevelSections } from '@truecourse/shared'
// Re-exported so this module stays the canonical import site for the runner and
// generator: OpenAPI detection is the predicate that flips {@link deriveSections}
// onto the per-operation branch.
export { isOpenApiDoc, deriveOpenApiSections } from '@truecourse/shared/openapi'
export type { RefResolutionContext } from '@truecourse/shared/openapi'

export interface DocSection {
  /** Slugified heading path (parent/child chain); disambiguated to be unique. */
  anchor: string
  /** `sha256:…` over the normalized section text. */
  fingerprint: string
  /** Raw heading text, for display. Basename for the whole-doc fallback. */
  headingText: string
  /** Heading level 1–6; `0` for the whole-document (non-markdown) fallback. */
  level: number
  /** 1-based line of the heading (`1` for the whole-doc fallback). */
  startLine: number
  /**
   * 1-based last line before the next same-or-higher-level heading — end of file
   * for the last section (a trailing newline adds no phantom line). Whole-doc
   * fallback: the document's line count.
   */
  endLine: number
}

export interface DocSectionIndex {
  /** Repo-relative document path. */
  doc: string
  /** Whether the doc was parsed as markdown (vs. the whole-doc fallback). */
  markdown: boolean
  /** Sections in document order. */
  sections: DocSection[]
  byAnchor: Map<string, DocSection>
  /** Fingerprint → sections carrying it (usually one; more if text repeats). */
  byFingerprint: Map<string, DocSection[]>
}

/** The outcome of checking one scenario binding against a doc's live index. */
export type BindingResolution =
  | { kind: 'match'; section: DocSection }
  | { kind: 'remap'; section: DocSection; from: string }
  | { kind: 'stale'; anchor: string; currentFingerprint: string }
  | { kind: 'orphaned'; anchor: string }

/** Slugify a heading (or filename) segment. See the module note for the rule. */
export function slugifyHeading(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * THE canonical section-text normalization. Every run of whitespace — spaces,
 * tabs, and line breaks (`\r`, `\n`, `\r\n` all count) — folds to a single space
 * and the ends are trimmed. So re-wrapping (reflow), trailing spaces, and mixed
 * line endings leave the fingerprint unchanged, while any change to the words
 * themselves changes it.
 */
export function normalizeSectionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** `sha256:<hex>` over the canonically-normalized text. */
export function fingerprintText(text: string): string {
  const digest = crypto.createHash('sha256').update(normalizeSectionText(text), 'utf-8').digest('hex')
  return `sha256:${digest}`
}

/** Document line count for line ranges: a trailing newline adds no phantom line. */
function countLines(content: string): number {
  const lines = content.split('\n')
  return Math.max(1, content.endsWith('\n') ? lines.length - 1 : lines.length)
}

/**
 * The doc's frontmatter `title`, when it declares one — a `---` fence on the very
 * first line, closed by the next `---`, holding a top-level `title:` entry. Only
 * the title is read (it is the doc's human name, and the only thing the lead
 * section needs from the block); everything else in the block is body text as far
 * as the section index is concerned. Quotes around the value are stripped.
 */
export function frontmatterTitle(lines: readonly string[]): string | null {
  if (lines.length === 0 || lines[0].trim() !== '---') return null
  // An unterminated block is not frontmatter — it is a horizontal rule and body.
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      close = i
      break
    }
  }
  if (close === -1) return null
  for (let i = 1; i < close; i++) {
    const m = /^title[ \t]*:[ \t]*(.*)$/.exec(lines[i])
    if (!m) continue
    const raw = m[1].trim()
    const value = /^(["'])([\s\S]*)\1$/.exec(raw)?.[2] ?? raw
    return value.trim() || null
  }
  return null
}

/** Line index where a section ends: the next heading of same-or-higher level. */
function sectionEndLine(headings: readonly RawHeading[], index: number, totalLines: number): number {
  const level = headings[index].level
  for (let j = index + 1; j < headings.length; j++) {
    if (headings[j].level <= level) return headings[j].line
  }
  return totalLines
}

/**
 * A section's raw text, keyed by anchor — what the generator sends the LLM.
 * `fullText` is the heading plus everything up to the next same-or-higher heading
 * (the fingerprinted slice, descendants included). `ownText` is the heading plus
 * only the preamble BEFORE the first subsection — the binding-rule unit: a
 * generator authoring for a parent asserts only claims stated in `ownText`, never
 * ones that live in a child section.
 */
export interface SectionText {
  anchor: string
  headingText: string
  level: number
  fullText: string
  ownText: string
}

/**
 * Derive the sections of a document with both their identity (anchor +
 * fingerprint) and their text (full + own). The single anchor-assignment
 * algorithm both {@link buildDocSectionIndex} and {@link extractSectionTexts}
 * build on, so the two can never disagree on an anchor.
 */
function deriveSections(
  doc: string,
  content: string,
  ctx?: RefResolutionContext,
): Array<DocSection & { fullText: string; ownText: string }> {
  // OpenAPI / Swagger documents: one bindable section per operation (method +
  // path). The section's text is a CANONICAL serialization of the resolved
  // operation slice (in-file $refs dereferenced), so generate and run derive
  // byte-identical fingerprints and a cosmetic reformat of the source never
  // churns them. The anchor is one synthetic level — `paths/<method>-<slug>` —
  // never the raw path (a raw `/users/{id}` would create fake hierarchy levels
  // and its `{id}` would fold to collide with `/users/id`); collisions fall to
  // the same `-N` disambiguation the markdown path uses. A doc detected as
  // OpenAPI but declaring no operations falls through to the whole-doc fallback.
  const openApiSections = isOpenApiDoc(doc, content) ? deriveOpenApiSections(content, ctx) : []
  if (openApiSections.length > 0) {
    const total = countLines(content)
    const used = new Set<string>()
    return openApiSections.map((op) => {
      const slug = slugifyHeading(`${op.method}-${op.slugSource}`) || 'operation'
      const base = `paths/${slug}`
      let anchor = base
      for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`
      used.add(anchor)
      return {
        anchor,
        fingerprint: fingerprintText(op.canonicalText),
        headingText: op.headingText,
        level: 1,
        startLine: 1,
        endLine: total,
        fullText: op.canonicalText,
        ownText: op.canonicalText,
      }
    })
  }

  if (!isMarkdownDoc(doc)) {
    const base = path.basename(doc)
    return [
      {
        anchor: slugifyHeading(base) || 'document',
        fingerprint: fingerprintText(content),
        headingText: base,
        level: 0,
        startLine: 1,
        endLine: countLines(content),
        fullText: content,
        ownText: content,
      },
    ]
  }

  const lines = content.split('\n')
  const totalLines = countLines(content)
  const headings = parseHeadings(lines)
  const out: Array<DocSection & { fullText: string; ownText: string }> = []
  const used = new Set<string>()
  const ancestors: Array<{ level: number; anchor: string }> = []

  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h]
    while (ancestors.length && ancestors[ancestors.length - 1].level >= heading.level) ancestors.pop()

    const parent = ancestors.length ? ancestors[ancestors.length - 1].anchor : ''
    const segment = slugifyHeading(heading.text) || 'section'
    const base = parent ? `${parent}/${segment}` : segment
    let anchor = base
    for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`
    used.add(anchor)

    const end = sectionEndLine(headings, h, lines.length)
    const fullText = lines.slice(heading.line, end).join('\n')
    // The very next heading in document order is either this section's first
    // child or the boundary that ends it — either way, own text stops there.
    const ownEnd = h + 1 < headings.length ? headings[h + 1].line : lines.length
    const ownText = lines.slice(heading.line, ownEnd).join('\n')
    // `end` is the exclusive 0-based slice end, so as a 1-based line it is already
    // the last line before the boundary; the last section clamps to the real line
    // count (a trailing newline's phantom empty split element never counts).
    out.push({
      anchor,
      fingerprint: fingerprintText(fullText),
      headingText: heading.text,
      level: heading.level,
      startLine: heading.line + 1,
      endLine: Math.min(end, totalLines),
      fullText,
      ownText,
    })
    ancestors.push({ level: heading.level, anchor })
  }

  const lead = leadSection(doc, lines, headings, totalLines, used)
  return lead ? [lead, ...out] : out
}

/**
 * The LEAD REGION as a bindable section: everything from the first byte of the
 * document down to its first heading (the whole document when it has none),
 * frontmatter included. Published documentation typically carries its title in
 * frontmatter and states substantive behavior before the first `##`, and without
 * this that text belongs to no section at all — a claim anchored there binds to
 * nothing and reads as permanently stale.
 *
 * Two rules keep it strictly ADDITIVE, so no repository in the field sees an
 * identity move:
 *
 *  - it is emitted only when the lead region has substance (a doc that opens
 *    directly with a heading, or whose lead is blank/whitespace, gets none — the
 *    behaviour before this section existed);
 *  - its anchor is claimed AFTER every heading has taken its own, so a doc whose
 *    frontmatter title also exists as a heading leaves the heading's anchor
 *    untouched and the lead takes the `-N` ordinal instead.
 *
 * Its text is the lead region ALONE — never the whole document. A lead is a
 * sibling of the top-level headings, not their parent, and folding their text in
 * would roll the lead's fingerprint on every unrelated edit further down.
 */
function leadSection(
  doc: string,
  lines: readonly string[],
  headings: readonly RawHeading[],
  totalLines: number,
  used: Set<string>,
): (DocSection & { fullText: string; ownText: string }) | null {
  const end = headings.length > 0 ? headings[0].line : lines.length
  const text = lines.slice(0, end).join('\n')
  if (normalizeSectionText(text) === '') return null

  // The doc's human name: its frontmatter title, or its filename when it declares
  // none — the same "name it by what it is" rule the non-markdown fallback uses.
  const headingText =
    frontmatterTitle(lines) ?? path.basename(doc, path.extname(doc))
  const base = slugifyHeading(headingText) || 'lead'
  let anchor = base
  for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`
  used.add(anchor)

  return {
    anchor,
    fingerprint: fingerprintText(text),
    headingText,
    // `0` — the level the whole-document fallback already uses for "this section
    // is not a heading". A lead has no heading by definition.
    level: 0,
    startLine: 1,
    endLine: Math.min(Math.max(end, 1), totalLines),
    fullText: text,
    ownText: text,
  }
}

/** Anchor → section text (full + own) for a document. See {@link SectionText}. */
export function extractSectionTexts(
  doc: string,
  content: string,
  ctx?: RefResolutionContext,
): Map<string, SectionText> {
  const map = new Map<string, SectionText>()
  for (const s of deriveSections(doc, content, ctx)) {
    map.set(s.anchor, { anchor: s.anchor, headingText: s.headingText, level: s.level, fullText: s.fullText, ownText: s.ownText })
  }
  return map
}

function indexFromSections(doc: string, markdown: boolean, sections: DocSection[]): DocSectionIndex {
  const byAnchor = new Map<string, DocSection>()
  const byFingerprint = new Map<string, DocSection[]>()
  for (const section of sections) {
    byAnchor.set(section.anchor, section)
    const list = byFingerprint.get(section.fingerprint)
    if (list) list.push(section)
    else byFingerprint.set(section.fingerprint, [section])
  }
  return { doc, markdown, sections, byAnchor, byFingerprint }
}

/**
 * Build the section index for one document.
 *
 * Duplicate anchors are disambiguated deterministically by document order: the
 * first occurrence keeps the slug path; each later collision (including a clash
 * with a real `-N` slug) takes the next free `-N` ordinal (`-2`, `-3`, …).
 * Descendants inherit the disambiguated ancestor segment, so a whole subtree
 * stays uniquely addressable.
 */
export function buildDocSectionIndex(
  doc: string,
  content: string,
  ctx?: RefResolutionContext,
): DocSectionIndex {
  const sections = deriveSections(doc, content, ctx).map(
    ({ anchor, fingerprint, headingText, level, startLine, endLine }): DocSection => ({
      anchor,
      fingerprint,
      headingText,
      level,
      startLine,
      endLine,
    }),
  )
  return indexFromSections(doc, isMarkdownDoc(doc), sections)
}

/**
 * Resolve a scenario binding (its anchor + fingerprint) against a doc's live
 * index. A `null` index means the doc is missing → orphaned. Precedence: an
 * exact anchor+fingerprint match executes; otherwise the same fingerprint at a
 * different anchor is a silent remap (the section moved); otherwise the anchor
 * still exists with a different fingerprint (the section was edited) → stale;
 * otherwise the section is gone → orphaned.
 */
export function resolveBinding(
  index: DocSectionIndex | null,
  anchor: string,
  fingerprint: string,
): BindingResolution {
  if (!index) return { kind: 'orphaned', anchor }

  const atAnchor = index.byAnchor.get(anchor)
  if (atAnchor && atAnchor.fingerprint === fingerprint) return { kind: 'match', section: atAnchor }

  const elsewhere = (index.byFingerprint.get(fingerprint) ?? []).filter((s) => s.anchor !== anchor)
  if (elsewhere.length > 0) {
    const target = [...elsewhere].sort((a, b) => a.anchor.localeCompare(b.anchor))[0]
    return { kind: 'remap', section: target, from: anchor }
  }

  if (atAnchor) return { kind: 'stale', anchor, currentFingerprint: atAnchor.fingerprint }
  return { kind: 'orphaned', anchor }
}

/**
 * The scenario-level verdict over ALL of a scenario's bindings — one scenario, one
 * outcome, whatever its milestone count.
 *
 * | per-bind resolutions            | scenario     |
 * | ------------------------------- | ------------ |
 * | every bind match/remap          | `executable` |
 * | any bind stale                  | `stale`      |
 * | some (not all) binds orphaned   | `stale`      |
 * | every bind orphaned             | `orphaned`   |
 *
 * A remap is transparent: the section kept its text and only moved, so the scenario
 * still runs. `orphaned` is reserved for the total loss — every section the scenario
 * asserts is gone; a partial loss is spec drift like any edit, so it lands in the
 * same `stale` bucket a regeneration clears.
 */
export type ScenarioBindingVerdict =
  | {
      kind: 'executable'
      resolutions: BindingResolution[]
      /** Set when the PRIMARY bind (`binds[0]`) moved — the anchor it was found at. */
      remappedTo?: string
    }
  | {
      kind: 'stale'
      resolutions: BindingResolution[]
      /** The first EDITED bind's current fingerprint; absent when only removals drove it. */
      currentFingerprint?: string
    }
  | { kind: 'orphaned'; resolutions: BindingResolution[] }

/**
 * Resolve every binding of a scenario against the live docs and fold the per-bind
 * resolutions into one verdict — see {@link ScenarioBindingVerdict} for the table.
 * `indexFor` returns a doc's section index, or `null` when the doc is missing.
 */
export function resolveScenarioBinds(
  binds: readonly { doc: string; section: string; fingerprint: string }[],
  indexFor: (doc: string) => DocSectionIndex | null,
): ScenarioBindingVerdict {
  const resolutions = binds.map((b) => resolveBinding(indexFor(b.doc), b.section, b.fingerprint))
  const orphaned = resolutions.filter((r) => r.kind === 'orphaned')
  if (orphaned.length === resolutions.length) return { kind: 'orphaned', resolutions }

  const firstStale = resolutions.find((r) => r.kind === 'stale')
  if (firstStale || orphaned.length > 0) {
    return {
      kind: 'stale',
      resolutions,
      ...(firstStale?.kind === 'stale' ? { currentFingerprint: firstStale.currentFingerprint } : {}),
    }
  }

  const primary = resolutions[0]
  return {
    kind: 'executable',
    resolutions,
    ...(primary?.kind === 'remap' ? { remappedTo: primary.section.anchor } : {}),
  }
}
