/**
 * The document tree: one reading of a doc shared by the scan, the guard and
 * the dashboard. What is under test:
 *
 * - the heading scan and the markdown check it starts from;
 * - the sections: anchors (slug chains, `-N` for repeats, the lead claimed
 *   last), line ranges, own and full text, and the whole-doc section of a
 *   doc that is not markdown;
 * - that the sections' anchors, lines and texts stay what they were, pinned
 *   over real docs in `tests/fixtures/doc-tree/sections-snapshot.json`;
 * - the windows: packing by section and by bounds, the lines a window shows,
 *   and that a doc's windows rejoin to the doc.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  docOutline,
  findSection,
  isMarkdownDoc,
  leadSection,
  parseDocTree,
  parseHeadings,
  planWindows,
  sectionOwnText,
  sectionText,
  slugifyHeading,
  windowText,
  type DocWindow,
} from '@truecourse/shared'

const ROOT = path.resolve(__dirname, '../..')

describe('isMarkdownDoc / parseHeadings', () => {
  it('recognizes markdown extensions case-insensitively, .mdx included', () => {
    expect(isMarkdownDoc('README.md')).toBe(true)
    expect(isMarkdownDoc('docs/guide.MARKDOWN')).toBe(true)
    expect(isMarkdownDoc('docs/guide.mdx')).toBe(true)
    expect(isMarkdownDoc('notes.txt')).toBe(false)
    expect(isMarkdownDoc('Makefile')).toBe(false)
  })

  it('parses ATX headings with levels and lines, skipping fences and bare hashes', () => {
    const lines = ['# One', '```', '# fenced', '```', '##', '  ## Two  ##']
    expect(parseHeadings(lines)).toEqual([
      { level: 1, text: 'One', line: 0 },
      { level: 2, text: 'Two', line: 5 },
    ])
  })
})

const DOC = `Intro prose that sits above every heading.
It spans two lines.

# Title

Title body.

## Auth

Auth body.

### Tokens

Tokens body.

## Storage

Storage body.
`

describe('parseDocTree sections', () => {
  const tree = parseDocTree('docs/guide.md', DOC)

  it('names each heading by its slug chain and the lead by the doc, claimed last', () => {
    expect(tree.sections.map((s) => [s.anchor, s.level, s.headingText])).toEqual([
      ['guide', 0, 'guide'],
      ['title', 1, 'Title'],
      ['title/auth', 2, 'Auth'],
      ['title/auth/tokens', 3, 'Tokens'],
      ['title/storage', 2, 'Storage'],
    ])
  })

  it('runs a section to the next same-or-higher heading, and its own text to the next heading of any level', () => {
    const auth = findSection(tree, 'Auth')!
    expect(sectionText(tree, auth)).toBe('## Auth\n\nAuth body.\n\n### Tokens\n\nTokens body.\n')
    expect(sectionOwnText(tree, auth)).toBe('## Auth\n\nAuth body.\n')
    expect(sectionText(tree, findSection(tree, 'Tokens')!)).toBe('### Tokens\n\nTokens body.\n')
    expect(sectionText(tree, findSection(tree, 'Storage')!)).toBe('## Storage\n\nStorage body.')
  })

  it('is the lead: everything above the first heading', () => {
    expect(sectionText(tree, leadSection(tree)!)).toBe('Intro prose that sits above every heading.\nIt spans two lines.\n')
    expect(leadSection(parseDocTree('a.md', '# Title\n\nBody.\n'))).toBeNull()
    expect(leadSection(parseDocTree('a.md', '\n\n# Title\n'))).toBeNull()
  })

  it('names the lead by the frontmatter title, taking the ordinal when a heading already has the slug', () => {
    const titled = parseDocTree('docs/x.md', '---\ntitle: "Guide"\n---\n\nLead.\n\n# Guide\n\nBody.\n')
    expect(titled.title).toBe('Guide')
    expect(titled.sections.map((s) => s.anchor)).toEqual(['guide-2', 'guide'])
  })

  it('slugs a heading: punctuation runs fold to one hyphen, emphasis markers drop', () => {
    expect(slugifyHeading('9.2.1 Git guard')).toBe('9-2-1-git-guard')
    expect(slugifyHeading('`contracts validate`')).toBe('contracts-validate')
    expect(slugifyHeading('9. Common — CLI Reference')).toBe('9-common-cli-reference')
    expect(slugifyHeading('Foo *Bar* _baz_')).toBe('foo-bar-baz')
    expect(slugifyHeading('  Trailing spaces  ')).toBe('trailing-spaces')
  })

  it('numbers repeated headings in document order, descendants inheriting the ordinal', () => {
    const tree = parseDocTree('a.md', '# A\n## B\n### C\n# A\n## B\n### C\n')
    expect(tree.sections.map((s) => s.anchor)).toEqual(['a', 'a/b', 'a/b/c', 'a-2', 'a-2/b', 'a-2/b/c'])
  })

  it('folds inline code, emphasis and case when a heading is looked up', () => {
    const tree = parseDocTree('a.md', '# Doc\n\n## `rm <id>`\n\nRemoves a task.\n')
    expect(sectionText(tree, findSection(tree, 'rm <id>')!)).toContain('Removes a task.')
    expect(sectionText(tree, findSection(tree, '`RM <ID>`')!)).toContain('Removes a task.')
    expect(findSection(tree, 'Deletion Policy')).toBeUndefined()
  })

  it('makes a doc that is not markdown one section named by its file', () => {
    const tree = parseDocTree('notes/plan.txt', '# not a heading\nline two\n')
    expect(tree.markdown).toBe(false)
    expect(tree.headings).toEqual([])
    expect(tree.sections).toEqual([{ anchor: 'plan-txt', headingText: 'plan.txt', level: 0, startLine: 1, endLine: 2, ownEndLine: 2 }])
    expect(sectionText(tree, tree.sections[0]!)).toBe('# not a heading\nline two')
  })

  it('lists the outline hash-prefixed, fenced `#` lines left out', () => {
    expect(docOutline(tree)).toBe(['# Title', '## Auth', '### Tokens', '## Storage'].join('\n'))
    expect(docOutline(parseDocTree('a.md', '# Real\n\n```sh\n# not a heading\n```\n\n## Also real\n'))).toBe('# Real\n## Also real')
    expect(docOutline(parseDocTree('a.md', 'just prose\n'))).toBe('(no headings)')
  })

  it('splits the sentences on first read, each under the heading the outline lists', () => {
    expect(tree.sentences.map((s) => [s.heading, s.text])).toEqual([
      [null, 'Intro prose that sits above every heading.'],
      [null, 'It spans two lines.'],
      ['Title', 'Title body.'],
      ['Auth', 'Auth body.'],
      ['Tokens', 'Tokens body.'],
      ['Storage', 'Storage body.'],
    ])
  })
})

interface SnapshotSection {
  anchor: string
  headingText: string
  level: number
  startLine: number
  endLine: number
  ownText: string
  fullText: string
}
const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/fixtures/doc-tree/sections-snapshot.json'), 'utf-8'),
) as Record<string, { sections: SnapshotSection[] }>

describe('the sections of real docs', () => {
  // A section's text ends where its lines end; the pinned texts may carry the
  // doc's final newline.
  const trimmed = (text: string): string => text.replace(/\n+$/, '')

  it.each(Object.keys(SNAPSHOT))('%s: the anchors, lines and texts stay pinned', (rel) => {
    const tree = parseDocTree(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'))
    expect(
      tree.sections.map((s) => ({
        anchor: s.anchor,
        headingText: s.headingText,
        level: s.level,
        startLine: s.startLine,
        endLine: s.endLine,
        ownText: trimmed(sectionOwnText(tree, s)),
        fullText: trimmed(sectionText(tree, s)),
      })),
    ).toEqual(SNAPSHOT[rel]!.sections.map((s) => ({ ...s, ownText: trimmed(s.ownText), fullText: trimmed(s.fullText) })))
  })
})

describe('planWindows', () => {
  const treeOf = (sections: number[]) =>
    parseDocTree(
      'doc.md',
      sections
        .map((n, s) => `## S${s}\n\n${Array.from({ length: n }, (_, i) => `Sentence ${i} of ${s}.`).join(' ')}`)
        .join('\n\n'),
    )
  const ranges = (windows: readonly DocWindow[]): number[][] => windows.map((w) => [w.from, w.to])

  it('packs whole sections in order, and covers every sentence once', () => {
    const tree = treeOf([3, 4, 3, 5])
    const windows = planWindows(tree, { maxSentences: 7, maxChars: 10_000 })
    expect(ranges(windows)).toEqual([[1, 7], [8, 10], [11, 15]])
    expect(windows.map((w) => w.index)).toEqual([1, 2, 3])
    expect(planWindows(tree, { maxSentences: 7, maxChars: 10_000 })).toEqual(windows)
  })

  it('cuts a section over the bound at sentence boundaries, its last piece sharing a window', () => {
    expect(ranges(planWindows(treeOf([2, 9, 1]), { maxSentences: 4, maxChars: 10_000 }))).toEqual([[1, 2], [3, 6], [7, 10], [11, 12]])
  })

  it('bounds the characters too; a sentence over the bound is a window alone', () => {
    const tree = parseDocTree('doc.md', `Short one. ${'X'.repeat(60)}. Short two. Short three.`)
    expect(ranges(planWindows(tree, { maxSentences: 100, maxChars: 30 }))).toEqual([[1, 1], [2, 2], [3, 4]])
  })

  it('starts a window at the heading above its first sentence, and the windows rejoin to the doc', () => {
    const tree = treeOf([3, 4, 3, 5])
    const windows = planWindows(tree, { maxSentences: 7, maxChars: 10_000 })
    expect(windows[1]).toMatchObject({ startLine: 9, endLine: 12 })
    expect(windowText(tree, windows[1]!).startsWith('## S2\n')).toBe(true)
    expect(windows.map((w) => windowText(tree, w)).join('\n')).toBe(tree.content)
  })

  it('is one window of every line for a doc with no sentences, and for a doc that fits', () => {
    const empty = parseDocTree('doc.md', '# Only a heading\n')
    expect(planWindows(empty, { maxChars: 100 })).toEqual([{ index: 1, from: 1, to: 0, startLine: 1, endLine: 2 }])
    expect(windowText(empty, planWindows(empty, { maxChars: 100 })[0]!)).toBe(empty.content)
    const fits = treeOf([2, 2])
    const [only, ...rest] = planWindows(fits, { maxChars: 10_000 })
    expect(rest).toEqual([])
    expect(windowText(fits, only!)).toBe(fits.content)
  })
})
