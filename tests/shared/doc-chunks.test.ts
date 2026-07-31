import { describe, it, expect } from 'vitest'
import { planDocChunks, splitTopLevelSections, isMarkdownDoc, parseHeadings } from '@truecourse/shared'

const section = (n: number, body: string): string => `## Section ${n}\n\n${body}\n`

describe('planDocChunks', () => {
  it('returns the whole content as one chunk when it fits the budget', () => {
    const content = '# Guide\n\nShort intro.\n\n## Usage\nRun the tool.\n'
    expect(planDocChunks('guide.md', content, 1000)).toEqual([
      { text: content, index: 1, total: 1, isFirst: true },
    ])
  })

  it('splits an oversized doc along headings and packs chunks up to the budget', () => {
    const sections = Array.from({ length: 20 }, (_, i) => section(i + 1, 'x'.repeat(400)))
    const content = `# Title\n\n${sections.join('\n')}`
    const chunks = planDocChunks('ref.md', content, 1500)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].isFirst).toBe(true)
    expect(chunks.slice(1).every((c) => !c.isFirst)).toBe(true)
    expect(chunks.every((c) => c.total === chunks.length)).toBe(true)
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i + 1))
    // Packed chunks respect the budget when sections are individually within it.
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500)
    // Chunks rejoin on the newline the packer split on — nothing dropped.
    expect(chunks.map((c) => c.text).join('\n')).toBe(content)
  })

  it('accepts a single section larger than the budget rather than splitting mid-section', () => {
    const huge = section(1, 'y'.repeat(5000))
    const content = `${section(2, 'small')}\n${huge}`
    const chunks = planDocChunks('ref.md', content, 1000)
    expect(chunks.some((c) => c.text.length > 1000)).toBe(true)
  })

  it('treats a headingless (plain) doc as one chunk regardless of size', () => {
    const content = 'line\n'.repeat(2000)
    expect(planDocChunks('NOTES.txt', content, 1000)).toHaveLength(1)
  })

  it('splits an oversized rst doc along its underlined sections', () => {
    const rstSection = (n: number, body: string): string =>
      `Section ${n}\n---------\n\n${body}\n`
    const sections = Array.from({ length: 20 }, (_, i) => rstSection(i + 1, 'x'.repeat(400)))
    const content = `Doc Title\n=========\n\n${sections.join('\n')}`
    const chunks = planDocChunks('ref.rst', content, 1500)

    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500)
    expect(chunks.map((c) => c.text).join('\n')).toBe(content)
  })
})

describe('splitTopLevelSections', () => {
  it('splits at the shallowest level that partitions the doc, keeping the title as preamble', () => {
    const content = '# Title\n\nintro\n\n## A\na body\n\n## B\nb body\n'
    const slices = splitTopLevelSections('doc.md', content)
    expect(slices).toHaveLength(3)
    expect(slices[0]).toContain('# Title')
    expect(slices[1].startsWith('## A')).toBe(true)
    expect(slices[2].startsWith('## B')).toBe(true)
  })

  it('never splits at a # line inside a fenced code block', () => {
    const content = '## Real\n\n```bash\n# not a heading\necho hi\n```\n\n## Next\nbody\n'
    const slices = splitTopLevelSections('doc.md', content)
    expect(slices).toHaveLength(2)
    expect(slices[0]).toContain('# not a heading')
  })
})

describe('isMarkdownDoc / parseHeadings', () => {
  it('recognizes markdown extensions case-insensitively', () => {
    expect(isMarkdownDoc('README.md')).toBe(true)
    expect(isMarkdownDoc('docs/guide.MARKDOWN')).toBe(true)
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
