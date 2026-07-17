import { describe, it, expect } from 'vitest'
import { docFormat, hasHeadingModel, scanHeadings } from '@truecourse/shared'

describe('docFormat', () => {
  it('maps markdown extensions (incl. variants) case-insensitively', () => {
    expect(docFormat('README.md')).toBe('markdown')
    expect(docFormat('docs/guide.MARKDOWN')).toBe('markdown')
    expect(docFormat('a.mdown')).toBe('markdown')
    expect(docFormat('a.MKD')).toBe('markdown')
  })

  it('maps rst and asciidoc case-insensitively, everything else plain', () => {
    expect(docFormat('guide.rst')).toBe('rst')
    expect(docFormat('guide.RST')).toBe('rst')
    expect(docFormat('guide.adoc')).toBe('asciidoc')
    expect(docFormat('guide.ADOC')).toBe('asciidoc')
    expect(docFormat('notes.txt')).toBe('plain')
    expect(docFormat('Makefile')).toBe('plain')
  })
})

describe('hasHeadingModel', () => {
  it('is true for every non-plain format', () => {
    expect(hasHeadingModel('a.md')).toBe(true)
    expect(hasHeadingModel('a.rst')).toBe(true)
    expect(hasHeadingModel('a.adoc')).toBe(true)
    expect(hasHeadingModel('a.txt')).toBe(false)
    expect(hasHeadingModel('Makefile')).toBe(false)
  })
})

describe('scanHeadings — dispatch', () => {
  it('runs the markdown scanner for markdown paths', () => {
    expect(scanHeadings('x.md', ['# One', 'body', '## Two'])).toEqual([
      { level: 1, text: 'One', line: 0 },
      { level: 2, text: 'Two', line: 2 },
    ])
  })

  it('returns nothing for a plain doc', () => {
    expect(scanHeadings('notes.txt', ['# Not a heading', 'text', '=====', 'still text'])).toEqual([])
  })
})

describe('scanHeadings — rst', () => {
  it('parses underline headings with docutils first-appearance level order', () => {
    const lines = [
      'Title',
      '=====',
      '',
      'Section One',
      '-----------',
      '',
      'Section Two',
      '-----------',
      '',
      'Subsection',
      '~~~~~~~~~~',
    ]
    expect(scanHeadings('doc.rst', lines)).toEqual([
      { level: 1, text: 'Title', line: 0 },
      { level: 2, text: 'Section One', line: 3 },
      { level: 2, text: 'Section Two', line: 6 },
      { level: 3, text: 'Subsection', line: 9 },
    ])
  })

  it('treats an overlined style as distinct from the underline-only same char', () => {
    const lines = ['=====', 'Over', '=====', '', 'Under', '=====']
    expect(scanHeadings('doc.rst', lines)).toEqual([
      { level: 1, text: 'Over', line: 0 },
      { level: 2, text: 'Under', line: 4 },
    ])
  })

  it('reports the overline line as the heading line', () => {
    const lines = ['=====', 'Header', '=====', '', 'Body']
    expect(scanHeadings('doc.rst', lines)).toEqual([{ level: 1, text: 'Header', line: 0 }])
  })

  it('allows an indented title under an overline', () => {
    const lines = ['=====', '  Indented', '=====']
    expect(scanHeadings('doc.rst', lines)).toEqual([{ level: 1, text: 'Indented', line: 0 }])
  })

  it('leniently accepts an underline shorter than the title', () => {
    const lines = ['Long Title Here', '====']
    expect(scanHeadings('doc.rst', lines)).toEqual([{ level: 1, text: 'Long Title Here', line: 0 }])
  })

  it('treats a punctuation run with a blank line above as a transition, not a heading', () => {
    const lines = ['Some paragraph text.', '', '--------', '', 'More text.']
    expect(scanHeadings('doc.rst', lines)).toEqual([])
  })

  it('rejects a title line that is itself an adornment run', () => {
    const lines = ['=====', '=====']
    expect(scanHeadings('doc.rst', lines)).toEqual([])
  })

  it('excludes indented (literal-block) pseudo-headings', () => {
    const lines = ['    Title', '    -----']
    expect(scanHeadings('doc.rst', lines)).toEqual([])
  })

  it('excludes simple-table borders (internal spaces)', () => {
    const lines = ['=====  =====', 'Col A  Col B', '=====  =====']
    expect(scanHeadings('doc.rst', lines)).toEqual([])
  })

  it('excludes grid-table borders (mixed characters)', () => {
    const lines = ['+-----+-----+', '| a   | b   |', '+-----+-----+']
    expect(scanHeadings('doc.rst', lines)).toEqual([])
  })
})

describe('scanHeadings — asciidoc', () => {
  it('parses = / == / === levels from the equals count', () => {
    const lines = ['= Doc Title', '== Section', '=== Subsection']
    expect(scanHeadings('doc.adoc', lines)).toEqual([
      { level: 1, text: 'Doc Title', line: 0 },
      { level: 2, text: 'Section', line: 1 },
      { level: 3, text: 'Subsection', line: 2 },
    ])
  })

  it('hides = lines inside a delimited listing block', () => {
    const lines = ['[source]', '----', '= not a heading', '== also not', '----', '= Real Title']
    expect(scanHeadings('doc.adoc', lines)).toEqual([{ level: 1, text: 'Real Title', line: 5 }])
  })

  it('hides = lines inside a table block', () => {
    const lines = ['|===', '| = cell one', '| = cell two', '|===', '== After Table']
    expect(scanHeadings('doc.adoc', lines)).toEqual([{ level: 2, text: 'After Table', line: 4 }])
  })
})
