/**
 * THE DOCUMENT TREE: one reading of a document that everything reading it
 * shares, so the scan, the guard and the dashboard never cut a doc three
 * ways. A tree is the doc's lines, its headings, its SECTIONS (a heading and
 * everything under it down to the next heading of the same or a higher level,
 * named by an anchor that is its heading chain slugified) and its SENTENCES
 * (the numbered pieces the scan points at, split on first read). The lead, the
 * text above the first heading, is a section too when it has substance, named
 * by the doc's frontmatter title or its filename, with its anchor claimed
 * after every heading has taken its own so a heading never loses its anchor to
 * it. A doc that is not markdown is one section, its filename the anchor.
 *
 * Anchors are stable identifiers: a scenario binds to a section by anchor and
 * a fingerprint of its text, and a coverage view paints a section by anchor.
 * Duplicate headings take `-2`, `-3`… in doc order, and a subtree inherits its
 * ancestor's disambiguated segment. Node-free: the dashboard client builds the
 * same tree from the same source.
 */

import { isMarkdownDoc, parseHeadings, type RawHeading } from './headings.js'
import { splitDocSentences, type DocSentence } from './sentences.js'

export interface DocSection {
  /** Slugified heading chain (parent/child), unique within the doc. */
  anchor: string
  /** The heading as written; the lead's and a non-markdown doc's is the doc's title or filename. */
  headingText: string
  /** Heading level 1–6; `0` for the lead and for a non-markdown doc's one section. */
  level: number
  /** 1-based inclusive lines: the heading line down to the next same-or-higher heading. */
  startLine: number
  endLine: number
  /** 1-based last line of the section's OWN text, before its first subsection; `endLine` when it has none. */
  ownEndLine: number
}

export interface DocTree {
  /** Repo-relative path or corpus ref. */
  doc: string
  markdown: boolean
  content: string
  lines: readonly string[]
  /** The frontmatter `title`, when the doc declares one. */
  title: string | null
  headings: readonly RawHeading[]
  /** The lead first when it has substance, then one section per heading, in doc order. */
  sections: readonly DocSection[]
  /** The doc's sentences, split on first read. */
  readonly sentences: readonly DocSentence[]
}

/** Slugify a heading (or filename) segment: strip inline markers, lowercase, fold runs of anything else to one hyphen. */
export function slugifyHeading(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The key two spellings of one heading match on: inline code and emphasis
 * markers stripped, case and surrounding space folded. A pointer written from
 * a rendered page carries no backticks; the source heading may.
 */
export function headingKey(heading: string): string {
  return heading.replace(/[`*_~]/g, '').trim().toLowerCase()
}

/**
 * The doc's frontmatter `title`, when it declares one: a `---` fence on the
 * very first line, closed by the next `---`, holding a top-level `title:`
 * entry. Quotes around the value are stripped. An unterminated block is a
 * horizontal rule and body, not frontmatter.
 */
export function frontmatterTitle(lines: readonly string[]): string | null {
  if (lines.length === 0 || lines[0].trim() !== '---') return null
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

/** The last path segment of a doc ref. */
export function docBasename(doc: string): string {
  return doc.split('/').pop() ?? doc
}

/** The doc's filename without its extension (a dotfile keeps its name). */
function docStem(doc: string): string {
  const base = docBasename(doc)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Line count for line ranges: a trailing newline adds no phantom line. */
function countLines(content: string, lines: readonly string[]): number {
  return Math.max(1, content.endsWith('\n') ? lines.length - 1 : lines.length)
}

/** Whether a run of lines holds anything but whitespace. */
const hasSubstance = (lines: readonly string[]): boolean => lines.some((l) => l.trim() !== '')

/** Line index where a heading's section ends: the next heading of same-or-higher level. */
function sectionEnd(headings: readonly RawHeading[], index: number, totalLines: number): number {
  const level = headings[index].level
  for (let j = index + 1; j < headings.length; j++) {
    if (headings[j].level <= level) return headings[j].line
  }
  return totalLines
}

export function parseDocTree(doc: string, content: string): DocTree {
  const lines = content.split('\n')
  const totalLines = countLines(content, lines)
  const markdown = isMarkdownDoc(doc)
  const headings = markdown ? parseHeadings(lines) : []
  const title = frontmatterTitle(lines)
  const sections = markdown ? markdownSections(doc, lines, headings, totalLines, title) : [wholeDocSection(doc, totalLines)]
  let sentences: DocSentence[] | undefined
  return {
    doc,
    markdown,
    content,
    lines,
    title,
    headings,
    sections,
    get sentences() {
      return (sentences ??= splitDocSentences(content))
    },
  }
}

function wholeDocSection(doc: string, totalLines: number): DocSection {
  const base = docBasename(doc)
  return { anchor: slugifyHeading(base) || 'document', headingText: base, level: 0, startLine: 1, endLine: totalLines, ownEndLine: totalLines }
}

function markdownSections(
  doc: string,
  lines: readonly string[],
  headings: readonly RawHeading[],
  totalLines: number,
  title: string | null,
): DocSection[] {
  const used = new Set<string>()
  const claim = (base: string): string => {
    let anchor = base
    for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`
    used.add(anchor)
    return anchor
  }
  const out: DocSection[] = []
  const ancestors: Array<{ level: number; anchor: string }> = []
  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h]
    while (ancestors.length && ancestors[ancestors.length - 1].level >= heading.level) ancestors.pop()
    const parent = ancestors.length ? ancestors[ancestors.length - 1].anchor : ''
    const segment = slugifyHeading(heading.text) || 'section'
    const anchor = claim(parent ? `${parent}/${segment}` : segment)
    const end = sectionEnd(headings, h, lines.length)
    // The very next heading in document order is either this section's first
    // child or the boundary that ends it; either way the own text stops there.
    const ownEnd = h + 1 < headings.length ? headings[h + 1].line : lines.length
    out.push({
      anchor,
      headingText: heading.text,
      level: heading.level,
      startLine: heading.line + 1,
      endLine: Math.min(end, totalLines),
      ownEndLine: Math.min(ownEnd, totalLines),
    })
    ancestors.push({ level: heading.level, anchor })
  }

  // The lead, claimed last so a frontmatter title that is also a heading
  // leaves the heading's anchor alone.
  const leadEnd = headings.length > 0 ? headings[0].line : lines.length
  if (!hasSubstance(lines.slice(0, leadEnd))) return out
  const headingText = title ?? docStem(doc)
  const endLine = Math.min(Math.max(leadEnd, 1), totalLines)
  const lead: DocSection = { anchor: claim(slugifyHeading(headingText) || 'lead'), headingText, level: 0, startLine: 1, endLine, ownEndLine: endLine }
  return [lead, ...out]
}

/** The section's text, heading line included, down to the next same-or-higher heading. */
export function sectionText(tree: DocTree, section: Pick<DocSection, 'startLine' | 'endLine'>): string {
  return tree.lines.slice(section.startLine - 1, section.endLine).join('\n')
}

/** The section's own text: its heading and what sits before its first subsection. */
export function sectionOwnText(tree: DocTree, section: Pick<DocSection, 'startLine' | 'ownEndLine'>): string {
  return tree.lines.slice(section.startLine - 1, section.ownEndLine).join('\n')
}

/** The sentences of a section's own text, in document order. */
export function sectionSentences(tree: DocTree, section: Pick<DocSection, 'startLine' | 'ownEndLine'>): DocSentence[] {
  return tree.sentences.filter((s) => s.startLine >= section.startLine && s.startLine <= section.ownEndLine)
}

/** The lead section, or null when the doc opens with a heading or the text above it is blank. */
export function leadSection(tree: DocTree): DocSection | null {
  return tree.sections.find((s) => s.level === 0) ?? null
}

/** The first heading section whose heading matches, by {@link headingKey}. */
export function findSection(tree: DocTree, heading: string): DocSection | undefined {
  const key = headingKey(heading)
  return tree.sections.find((s) => s.level > 0 && headingKey(s.headingText) === key)
}

/** The doc's headings, one per line, prefixed with their level's hashes. */
export function docOutline(tree: DocTree): string {
  if (tree.headings.length === 0) return '(no headings)'
  return tree.headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n')
}
