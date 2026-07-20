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

  it('treats a non-markdown doc as one chunk regardless of size', () => {
    const content = 'line\n'.repeat(2000)
    expect(planDocChunks('NOTES.txt', content, 1000)).toHaveLength(1)
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

  // A docs-site .mdx as Mintlify/Docusaurus actually author it: the title lives
  // in front-matter rather than an H1, prose is wrapped in block-level JSX, and
  // fenced snippets contain shell comments. None of that is heading structure,
  // so the file must split exactly like the .md it would otherwise be — the
  // extension is the only difference between these two inputs.
  it('splits a JSX-and-front-matter .mdx exactly like its .md equivalent', () => {
    const content = [
      '---',
      'title: "Guide"',
      '---',
      '',
      "import Snippet from '/snippets/objects/order.mdx';",
      '',
      'Lead prose.',
      '',
      '<CardGroup cols={2}>',
      '  <Card title="Community" href="https://example.com">',
      '    Card body prose.',
      '  </Card>',
      '</CardGroup>',
      '',
      '## Section One',
      '',
      'Body one.',
      '',
      '```bash',
      '# a shell comment, not a heading',
      'echo hi',
      '```',
      '',
      '## Section Two',
      '',
      'Body two.',
      '',
    ].join('\n')

    expect(parseHeadings(content.split('\n')).map((h) => h.text)).toEqual([
      'Section One',
      'Section Two',
    ])

    const asMdx = splitTopLevelSections('docs/guide.mdx', content)
    expect(asMdx).toEqual(splitTopLevelSections('docs/guide.md', content))
    // preamble (front-matter + import + JSX card) + the two H2 sections
    expect(asMdx).toHaveLength(3)
    expect(asMdx[0]).toContain('<CardGroup cols={2}>')
    expect(asMdx[1].startsWith('## Section One')).toBe(true)
  })

  // Mintlify snippets are transclusion fragments — pure JSX field definitions
  // with no headings. They are real corpus docs (the component attributes carry
  // API field names and types), and having no heading structure they are one
  // whole-doc chunk. Pinned because a filename-derived anchor looks like a bug
  // to anyone who has not read this test.
  it('treats a heading-less .mdx fragment as a single chunk', () => {
    const content = [
      '<Expandable title="properties">',
      '  <ResponseField name="total" type="decimal">',
      '    The total amount of the order',
      '  </ResponseField>',
      '</Expandable>',
      '',
    ].join('\n')

    expect(parseHeadings(content.split('\n'))).toEqual([])
    expect(splitTopLevelSections('docs/snippets/order.mdx', content)).toEqual([content])
  })
})

describe('isMarkdownDoc / parseHeadings', () => {
  it('recognizes markdown extensions case-insensitively', () => {
    expect(isMarkdownDoc('README.md')).toBe(true)
    expect(isMarkdownDoc('docs/guide.MARKDOWN')).toBe(true)
    expect(isMarkdownDoc('notes.txt')).toBe(false)
    expect(isMarkdownDoc('Makefile')).toBe(false)
  })

  // MDX is markdown-with-JSX: its prose, headings and fences are byte-identical
  // to markdown, so it gets the same heading-aware treatment. Failing this
  // predicate is silent — the doc degrades to a single filename-anchored
  // section rather than being skipped — so it's asserted explicitly.
  it('recognizes .mdx as markdown', () => {
    expect(isMarkdownDoc('docs/guide.mdx')).toBe(true)
    expect(isMarkdownDoc('docs/guide.MDX')).toBe(true)
  })

  it('parses ATX headings with levels and lines, skipping fences and bare hashes', () => {
    const lines = ['# One', '```', '# fenced', '```', '##', '  ## Two  ##']
    expect(parseHeadings(lines)).toEqual([
      { level: 1, text: 'One', line: 0 },
      { level: 2, text: 'Two', line: 5 },
    ])
  })
})
