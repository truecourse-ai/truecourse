import { describe, it, expect } from 'vitest'
import {
  buildDocSectionIndex,
  resolveBinding,
  slugifyHeading,
  normalizeSectionText,
  fingerprintText,
  isMarkdownDoc,
} from '@truecourse/guard-runner'

const md = (lines: string[]): string => lines.join('\n')

describe('slugifyHeading', () => {
  it('folds punctuation runs to single hyphens and strips emphasis markers', () => {
    expect(slugifyHeading('9.2.1 Git guard')).toBe('9-2-1-git-guard')
    expect(slugifyHeading('`contracts validate`')).toBe('contracts-validate')
    expect(slugifyHeading('9. Common — CLI Reference')).toBe('9-common-cli-reference')
    expect(slugifyHeading('Foo *Bar* _baz_')).toBe('foo-bar-baz')
    expect(slugifyHeading('  Trailing spaces  ')).toBe('trailing-spaces')
  })
})

describe('normalizeSectionText / fingerprintText', () => {
  it('collapses every whitespace run and trims the ends', () => {
    expect(normalizeSectionText('  a\t b\n\n c  ')).toBe('a b c')
  })

  it('is invariant to reflow, trailing spaces, and line endings', () => {
    const base = fingerprintText('# H\nHello world, this wraps here.')
    expect(fingerprintText('# H\nHello   world,   this wraps here.   ')).toBe(base)
    expect(fingerprintText('# H\nHello world,\nthis wraps here.')).toBe(base)
    expect(fingerprintText('# H\r\nHello world, this wraps here.\r\n')).toBe(base)
  })

  it('changes when a word changes', () => {
    expect(fingerprintText('Hello world')).not.toBe(fingerprintText('Hello there'))
  })

  it('is prefixed with the hash algorithm', () => {
    expect(fingerprintText('x')).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('buildDocSectionIndex — heading tree', () => {
  const doc = md([
    '# Title',
    'Intro text.',
    '',
    '## A',
    'Body A.',
    '',
    '### A1',
    'Body A1.',
    '',
    '## B',
    'Body B.',
  ])

  it('derives slugified parent/child anchor paths', () => {
    const idx = buildDocSectionIndex('docs/spec.md', doc)
    expect(idx.markdown).toBe(true)
    expect(idx.sections.map((s) => s.anchor)).toEqual(['title', 'title/a', 'title/a/a1', 'title/b'])
    expect(idx.sections.map((s) => s.level)).toEqual([1, 2, 3, 2])
  })

  it('extends a section to the next same-or-higher heading (parents include children)', () => {
    const withA1 = buildDocSectionIndex('docs/spec.md', doc)
    const editedA1 = buildDocSectionIndex(
      'docs/spec.md',
      doc.replace('Body A1.', 'Body A1 rewritten.'),
    )
    const fpOf = (idx: ReturnType<typeof buildDocSectionIndex>, anchor: string) =>
      idx.byAnchor.get(anchor)!.fingerprint

    // Editing A1's body changes A1 AND its ancestors A and Title (they span it),
    // but leaves sibling B untouched.
    expect(fpOf(editedA1, 'title/a/a1')).not.toBe(fpOf(withA1, 'title/a/a1'))
    expect(fpOf(editedA1, 'title/a')).not.toBe(fpOf(withA1, 'title/a'))
    expect(fpOf(editedA1, 'title')).not.toBe(fpOf(withA1, 'title'))
    expect(fpOf(editedA1, 'title/b')).toBe(fpOf(withA1, 'title/b'))
  })
})

describe('buildDocSectionIndex — line ranges', () => {
  it('spans each section from its heading line to the last line before the next same-or-higher heading', () => {
    const doc = md([
      '# Alpha', // line 1
      'a body', // line 2
      '', // line 3
      '## Beta', // line 4
      'b body', // line 5
      '# Gamma', // line 6
      'g body', // line 7
    ])
    const idx = buildDocSectionIndex('docs/spec.md', doc)
    const lines = (anchor: string) => {
      const s = idx.byAnchor.get(anchor)!
      return [s.startLine, s.endLine]
    }
    // Alpha spans through Beta (its child) up to the line before Gamma.
    expect(lines('alpha')).toEqual([1, 5])
    expect(lines('alpha/beta')).toEqual([4, 5])
    // The last section runs to the end of the file.
    expect(lines('gamma')).toEqual([6, 7])
  })

  it('a trailing newline does not add a phantom line to the last section', () => {
    const idx = buildDocSectionIndex('docs/spec.md', '# Only\nbody\n')
    expect(idx.sections[0].startLine).toBe(1)
    expect(idx.sections[0].endLine).toBe(2)
  })

  it('a heading immediately followed by a sibling spans exactly its own line', () => {
    const idx = buildDocSectionIndex('docs/spec.md', md(['# A', '# B', 'b body']))
    expect(idx.byAnchor.get('a')).toMatchObject({ startLine: 1, endLine: 1 })
    expect(idx.byAnchor.get('b')).toMatchObject({ startLine: 2, endLine: 3 })
  })

  it('the whole-doc (non-markdown) fallback spans 1..lineCount', () => {
    const idx = buildDocSectionIndex('notes/setup.txt', 'one\ntwo\nthree')
    expect(idx.sections[0]).toMatchObject({ startLine: 1, endLine: 3 })
    // Trailing newline excluded here too.
    const withNl = buildDocSectionIndex('notes/setup.txt', 'one\ntwo\n')
    expect(withNl.sections[0]).toMatchObject({ startLine: 1, endLine: 2 })
  })
})

describe('buildDocSectionIndex — duplicate headings', () => {
  it('disambiguates repeated anchors with an ordinal suffix, in document order', () => {
    const idx = buildDocSectionIndex('docs/spec.md', md(['# Root', '## Dup', 'x', '## Dup', 'y', '## Dup', 'z']))
    expect(idx.sections.map((s) => s.anchor)).toEqual(['root', 'root/dup', 'root/dup-2', 'root/dup-3'])
  })

  it('bumps past an ordinal that collides with a real `-N` slug', () => {
    const idx = buildDocSectionIndex('docs/spec.md', md(['# Root', '## Item', '## Item', '## Item 2']))
    // 1st Item → item; 2nd Item → item taken → item-2; "Item 2" slugs to item-2,
    // which is now taken by the disambiguation → next free is item-2-2.
    expect(idx.sections.map((s) => s.anchor)).toEqual(['root', 'root/item', 'root/item-2', 'root/item-2-2'])
  })
})

describe('buildDocSectionIndex — fenced code blocks', () => {
  it('never treats `#` lines inside a fence as headings', () => {
    const idx = buildDocSectionIndex(
      'docs/spec.md',
      md(['# Doc', 'intro', '', '```bash', '# 1. not a heading', '## also not a heading', '```', '', '## Real', 'real body']),
    )
    expect(idx.sections.map((s) => s.anchor)).toEqual(['doc', 'doc/real'])
  })
})

describe('buildDocSectionIndex — non-markdown fallback', () => {
  it('collapses a non-markdown doc to one whole-document section', () => {
    const idx = buildDocSectionIndex('config.json', '{ "a": 1 }')
    expect(idx.markdown).toBe(false)
    expect(idx.sections).toHaveLength(1)
    expect(idx.sections[0]).toMatchObject({ anchor: 'config-json', level: 0 })
    expect(idx.sections[0].fingerprint).toBe(fingerprintText('{ "a": 1 }'))
  })

  it('recognizes markdown by extension', () => {
    expect(isMarkdownDoc('docs/x.md')).toBe(true)
    expect(isMarkdownDoc('docs/x.markdown')).toBe(true)
    expect(isMarkdownDoc('docs/x.txt')).toBe(false)
  })
})

describe('resolveBinding', () => {
  const doc = md(['# Spec', '## Top', 'top body', '### Rate limiting', 'limits after 5', '## Other', 'other body'])
  const idx = buildDocSectionIndex('docs/spec.md', doc)
  const rate = idx.byAnchor.get('spec/top/rate-limiting')!

  it('matches on exact anchor + fingerprint', () => {
    expect(resolveBinding(idx, rate.anchor, rate.fingerprint)).toEqual({ kind: 'match', section: rate })
  })

  it('remaps when the fingerprint is found at a different anchor', () => {
    const res = resolveBinding(idx, 'spec/moved/rate-limiting', rate.fingerprint)
    expect(res).toMatchObject({ kind: 'remap', from: 'spec/moved/rate-limiting' })
    if (res.kind === 'remap') expect(res.section.anchor).toBe('spec/top/rate-limiting')
  })

  it('is stale when the anchor exists but the fingerprint differs', () => {
    const res = resolveBinding(idx, rate.anchor, 'sha256:deadbeef')
    expect(res).toEqual({ kind: 'stale', anchor: rate.anchor, currentFingerprint: rate.fingerprint })
  })

  it('is orphaned when neither anchor nor fingerprint is found', () => {
    expect(resolveBinding(idx, 'spec/gone', 'sha256:deadbeef')).toEqual({ kind: 'orphaned', anchor: 'spec/gone' })
  })

  it('is orphaned when the doc is missing (null index)', () => {
    expect(resolveBinding(null, 'spec/top', 'sha256:x')).toEqual({ kind: 'orphaned', anchor: 'spec/top' })
  })
})
