/**
 * Section BINDING over a spec document, LLM-free: the runner checks each
 * scenario's binding against the live doc before it executes, and the
 * generator authors bindings with the same functions. The sections themselves
 * come from the shared document tree (`parseDocTree`): a section is a heading
 * plus its body down to the next heading of the same or a higher level, named
 * by an anchor, and here it gains a FINGERPRINT, a hash of its normalized text,
 * so a binding tells "moved" from "edited" from "gone".
 *
 * An OpenAPI document is the one doc the tree does not cut: its bindable
 * sections are its OPERATIONS, each fingerprinted over a canonical
 * serialization of the resolved operation, so a cosmetic reformat never churns
 * a binding.
 */

import crypto from 'node:crypto'
import {
  isMarkdownDoc,
  parseDocTree,
  sectionOwnText,
  sectionText,
  sentenceKey,
  slugifyHeading,
  type DocSentence,
  type DocTree,
} from '@truecourse/shared'
import { isOpenApiDoc, deriveOpenApiSections, type RefResolutionContext } from '@truecourse/shared/openapi'

// Re-exported so this module stays the canonical import site for the runner
// and generator: the slug rule anchors are made of, the markdown check, and the
// OpenAPI detection that flips {@link deriveSections} onto the per-operation branch.
export { isMarkdownDoc, slugifyHeading } from '@truecourse/shared'
export { isOpenApiDoc, deriveOpenApiSections } from '@truecourse/shared/openapi'
export type { RefResolutionContext } from '@truecourse/shared/openapi'

export interface DocSection {
  /** Slugified heading path (parent/child chain); disambiguated to be unique. */
  anchor: string
  /** `sha256:…` over the normalized section text. */
  fingerprint: string
  /** Raw heading text, for display. Basename for the whole-doc fallback. */
  headingText: string
  /** Heading level 1–6; `0` for the lead and the whole-document (non-markdown) fallback. */
  level: number
  /** 1-based line of the heading (`1` for the lead and the whole-doc fallback). */
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
  /** The document's tree, whose sentences a binding is resolved against. */
  tree: DocTree
}

/**
 * The outcome of checking one scenario binding against a doc's live index. A
 * binding resolves by its SENTENCES: every one still in the document is a
 * match (at the section the first now sits in, `from` naming the bound anchor
 * when that moved); any gone while the bound section or a sentence remains is
 * stale; the section gone with every sentence, or the document gone, is
 * orphaned.
 */
export type BindingResolution =
  | { kind: 'match'; section: DocSection; from?: string }
  | { kind: 'stale'; anchor: string; currentFingerprint?: string; missing: string[] }
  | { kind: 'orphaned'; anchor: string }

/** What a binding carries for resolution. */
export interface BindingRef {
  section: string
  sentences: readonly string[]
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
 * fingerprint) and their text (full + own). The single derivation both
 * {@link buildDocSectionIndex} and {@link extractSectionTexts} build on, so
 * the two can never disagree on an anchor.
 */
function deriveSections(
  doc: string,
  content: string,
  ctx?: RefResolutionContext,
  parsed?: DocTree,
): Array<DocSection & { fullText: string; ownText: string }> {
  // One bindable section per operation (method + path). The anchor is one
  // synthetic level — `paths/<method>-<slug>` — never the raw path (a raw
  // `/users/{id}` would create fake hierarchy levels and its `{id}` would fold
  // to collide with `/users/id`); collisions fall to the same `-N`
  // disambiguation the markdown path uses. A doc detected as OpenAPI but
  // declaring no operations falls through to the tree's whole-doc section.
  const openApiSections = isOpenApiDoc(doc, content) ? deriveOpenApiSections(content, ctx) : []
  if (openApiSections.length > 0) {
    const total = parseDocTree(doc, content).sections[0]!.endLine
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

  const tree = parsed ?? parseDocTree(doc, content)
  return tree.sections.map((s) => {
    const fullText = sectionText(tree, s)
    return {
      anchor: s.anchor,
      fingerprint: fingerprintText(fullText),
      headingText: s.headingText,
      level: s.level,
      startLine: s.startLine,
      endLine: s.endLine,
      fullText,
      ownText: sectionOwnText(tree, s),
    }
  })
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

function indexFromSections(doc: string, markdown: boolean, sections: DocSection[], tree: DocTree): DocSectionIndex {
  const byAnchor = new Map<string, DocSection>()
  const byFingerprint = new Map<string, DocSection[]>()
  for (const section of sections) {
    byAnchor.set(section.anchor, section)
    const list = byFingerprint.get(section.fingerprint)
    if (list) list.push(section)
    else byFingerprint.set(section.fingerprint, [section])
  }
  return { doc, markdown, sections, byAnchor, byFingerprint, tree }
}

/** Build the section index for one document: the tree's sections, fingerprinted, over the tree itself. */
export function buildDocSectionIndex(
  doc: string,
  content: string,
  ctx?: RefResolutionContext,
): DocSectionIndex {
  const tree = parseDocTree(doc, content)
  const sections = deriveSections(doc, content, ctx, tree).map(
    ({ anchor, fingerprint, headingText, level, startLine, endLine }): DocSection => ({
      anchor,
      fingerprint,
      headingText,
      level,
      startLine,
      endLine,
    }),
  )
  return indexFromSections(doc, isMarkdownDoc(doc), sections, tree)
}

/** A document's sentences by key, built once per index. */
const sentenceIndexes = new WeakMap<DocSectionIndex, Map<string, DocSentence>>()
function sentencesByKey(index: DocSectionIndex): Map<string, DocSentence> {
  let map = sentenceIndexes.get(index)
  if (!map) {
    map = new Map(index.tree.sentences.map((s) => [sentenceKey(s.text, s.repeat), s]))
    sentenceIndexes.set(index, map)
  }
  return map
}

/** The section whose own text holds a line, else the last section opened above it. */
function sectionAtLine(index: DocSectionIndex, line: number): DocSection {
  const tree = index.tree.sections
  const own = tree.find((s) => s.startLine <= line && line <= s.ownEndLine)
    ?? [...tree].reverse().find((s) => s.startLine <= line)
    ?? tree[0]
  const section = own && index.byAnchor.get(own.anchor)
  return section ?? index.sections[0]!
}


/**
 * Resolve a scenario binding against a doc's live index, by its sentences. A
 * `null` index means the doc is missing → orphaned. Every sentence still in
 * the document → match, at the section the first one sits in now (`from` set
 * when that is not the bound anchor). Any sentence gone → stale, naming the
 * missing keys and the bound section's current fingerprint when that section
 * still exists; the section gone along with every sentence → orphaned.
 */
export function resolveBinding(index: DocSectionIndex | null, bind: BindingRef): BindingResolution {
  if (!index) return { kind: 'orphaned', anchor: bind.section }
  const sentences = sentencesByKey(index)
  const found = bind.sentences.map((key) => sentences.get(key))
  const missing = bind.sentences.filter((_, i) => found[i] === undefined)
  if (missing.length > 0) {
    const current = index.byAnchor.get(bind.section)
    if (!current && missing.length === bind.sentences.length) return { kind: 'orphaned', anchor: bind.section }
    return { kind: 'stale', anchor: bind.section, ...(current ? { currentFingerprint: current.fingerprint } : {}), missing }
  }
  const first = Math.min(...found.map((s) => s!.startLine))
  const section = sectionAtLine(index, first)
  return section.anchor === bind.section ? { kind: 'match', section } : { kind: 'match', section, from: bind.section }
}

/**
 * The scenario-level verdict over ALL of a scenario's bindings — one scenario, one
 * outcome, whatever its milestone count.
 *
 * | per-bind resolutions            | scenario     |
 * | ------------------------------- | ------------ |
 * | every bind match                | `executable` |
 * | any bind stale                  | `stale`      |
 * | some (not all) binds orphaned   | `stale`      |
 * | every bind orphaned             | `orphaned`   |
 *
 * A sentence that moved to another section still matches: the scenario runs,
 * and the primary bind's new section rides as `remappedTo`. `orphaned` is
 * reserved for the total loss — every sentence the scenario asserts is gone; a
 * partial loss is spec drift like any edit, so it lands in the same `stale`
 * bucket a regeneration clears.
 */
export type ScenarioBindingVerdict =
  | {
      kind: 'executable'
      resolutions: BindingResolution[]
      /** Set when the PRIMARY bind's sentences now sit under another section — the anchor they were found at. */
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
  binds: readonly ({ doc: string } & BindingRef)[],
  indexFor: (doc: string) => DocSectionIndex | null,
): ScenarioBindingVerdict {
  const resolutions = binds.map((b) => resolveBinding(indexFor(b.doc), b))
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
    ...(primary?.kind === 'match' && primary.from ? { remappedTo: primary.section.anchor } : {}),
  }
}
