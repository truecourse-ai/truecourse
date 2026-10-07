/**
 * A doc's sentences: the numbered pieces a record session must account for one by
 * one. What is under test:
 *
 * - on real documentation (excerpts under `tests/fixtures/doc-sentences/`), every
 *   sentence's text is an exact slice of the body, numbering runs 1..N in doc
 *   order, and every sentence's heading is one the doc's outline lists;
 * - an edit renumbers only the sentences at and after it;
 * - each sentence kind, and what is not a sentence, on those docs;
 * - the edge rules the module states, one small doc each;
 * - the presentation a briefing shows.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODE_LINES_PER_SENTENCE, parseHeadings, presentSentence, splitDocSentences, type DocSentence } from '@truecourse/shared'

const FIXTURES = path.resolve(__dirname, '../fixtures/doc-sentences')
const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf-8')
const FIXTURE_NAMES = fs.readdirSync(FIXTURES).sort()

const ofKind = <K extends DocSentence['kind']>(sentences: readonly DocSentence[], kind: K): Array<Extract<DocSentence, { kind: K }>> =>
  sentences.filter((u): u is Extract<DocSentence, { kind: K }> => u.kind === kind)
const unitWith = (sentences: readonly DocSentence[], text: string): DocSentence => {
  const found = sentences.find((u) => u.text.includes(text))
  if (!found) throw new Error(`no sentence holds "${text}"`)
  return found
}
const texts = (body: string): string[] => splitDocSentences(body).map((u) => u.text)

describe('splitDocSentences on real docs', () => {
  it.each(FIXTURE_NAMES)('%s: every sentence is an exact slice, numbered 1..N in doc order', (name) => {
    const body = fixture(name)
    const sentences = splitDocSentences(body)
    expect(sentences.length).toBeGreaterThan(10)
    const outline = new Set(parseHeadings(body.split('\n')).map((h) => h.text))
    let previousEnd = 0
    sentences.forEach((sentence, i) => {
      expect(sentence.n).toBe(i + 1)
      expect(body.slice(sentence.start, sentence.end)).toBe(sentence.text)
      // A code part, and a run of frontmatter, starts at its first line's start, so
      // its indentation stays; the rest are trimmed.
      if (sentence.kind === 'code' || (sentence.kind === 'frontmatter' && sentence.field === null)) {
        expect(sentence.start === 0 || body[sentence.start - 1] === '\n').toBe(true)
      }
      else expect(sentence.text).toBe(sentence.text.trim())
      expect(sentence.text.trim()).not.toBe('')
      expect(sentence.start).toBeGreaterThanOrEqual(previousEnd)
      previousEnd = sentence.end
      expect(sentence.startLine).toBe(body.slice(0, sentence.start).split('\n').length)
      expect(sentence.endLine).toBe(body.slice(0, sentence.end).split('\n').length)
      if (sentence.heading !== null) expect(outline.has(sentence.heading)).toBe(true)
    })
    expect(splitDocSentences(body)).toEqual(sentences)
  })

  it('renumbers only the sentences at and after an edit', () => {
    const body = fixture('quickstart.mdx')
    const before = splitDocSentences(body)
    const appended = splitDocSentences(`${body}\n## Later\n\nOne more sentence here.\n`)
    expect(appended.slice(0, before.length)).toEqual(before)
    expect(appended[before.length]).toMatchObject({ kind: 'prose', heading: 'Later', text: 'One more sentence here.' })

    const at = body.indexOf('### Prerequisites')
    const edited = splitDocSentences(`${body.slice(0, at)}An inserted sentence.\n\n${body.slice(at)}`)
    const untouched = before.filter((u) => u.end <= at)
    expect(edited.slice(0, untouched.length)).toEqual(untouched)
    expect(edited[untouched.length]!.text).toBe('An inserted sentence.')
    expect(edited.slice(untouched.length + 1).map((u) => [u.n, u.text])).toEqual(
      before.slice(untouched.length).map((u) => [u.n + 1, u.text]),
    )
  })

  it('getting-started: frontmatter, card and accordion titles, table rows, callout prose', () => {
    const sentences = splitDocSentences(fixture('getting-started.mdx'))
    expect(sentences.slice(0, 2)).toMatchObject([
      { kind: 'frontmatter', field: 'title', text: 'Introduction to Reactive Resume', heading: null },
      { kind: 'frontmatter', field: 'description', heading: null },
    ])
    expect(sentences[1]!.text.startsWith('Reactive Resume is a free, open-source resume builder')).toBe(true)

    // A component's quoted title is a sentence; its body is prose cut into sentences.
    expect(unitWith(sentences, 'Export Anywhere')).toMatchObject({ kind: 'tag', tag: 'Card', attribute: 'title', text: 'Export Anywhere' })
    expect(unitWith(sentences, 'Completely Free & Open Source')).toMatchObject({ kind: 'tag', tag: 'Accordion' })
    expect(unitWith(sentences, 'Your data stays yours.')).toMatchObject({ kind: 'prose', text: 'Your data stays yours.' })
    // A sentence hard-wrapped over two lines is one sentence.
    expect(unitWith(sentences, 'codebase is available on')).toMatchObject({ kind: 'prose', startLine: 37, endLine: 38 })

    // Tag-only lines (`<Frame>`, `<img … />`) are no sentence: nothing holds the image's alt text.
    expect(sentences.some((u) => u.text.includes('Banner') || u.text.includes('<Frame>'))).toBe(false)

    // Header and separator rows are not sentences; each body row is, with the columns.
    const rows = ofKind(sentences, 'row')
    expect(rows).toHaveLength(9)
    expect(rows[0]).toMatchObject({ heading: 'Tech stack', columns: ['Category', 'Technology'] })
    expect(rows[0]!.text).toBe('| Framework        | TanStack Start (React 19, Vite) |')
    expect(sentences.some((u) => /Category\s+\|\s+Technology/.test(u.text) || /^\|\s*-/.test(u.text))).toBe(false)

    // A callout's bold lead-in ends a sentence of its own.
    expect(unitWith(sentences, 'Need help?')).toMatchObject({ kind: 'prose', text: '**Need help?**', heading: 'Community & support' })
  })

  it('quickstart: steps, fences inside components, lists and their intro, callouts', () => {
    const sentences = splitDocSentences(fixture('quickstart.mdx'))
    expect(unitWith(sentences, 'Create an Account')).toMatchObject({ kind: 'tag', tag: 'Step', attribute: 'title' })
    expect(unitWith(sentences, 'sign up for free using your email')).toMatchObject({ kind: 'prose', startLine: 27, endLine: 28 })

    // Sentences that end right after an inline code span.
    expect(unitWith(sentences, 'runs entirely client-side').text).toBe(
      '**From v5.1.0 onwards** — PDF generation now runs entirely client-side via `@react-pdf/renderer`.',
    )
    expect(unitWith(sentences, 'environment variables are no longer read').text.endsWith('from your `.env`.')).toBe(true)

    // A tab-indented fence inside a <Step> is a code sentence.
    const clone = unitWith(sentences, 'git clone https://github.com/reactive-resume')
    expect(clone).toMatchObject({ kind: 'code', lang: 'bash', part: 1, parts: 1, heading: 'Quick deployment' })

    // A list's items name the sentence that introduces it.
    const intro = unitWith(sentences, 'ensure you have the following installed')
    const docker = unitWith(sentences, '[Docker](https://docs.docker.com/get-docker/)')
    expect(docker).toMatchObject({ kind: 'item', depth: 0, intro: intro.n })
    expect(docker.text).toBe('[Docker](https://docs.docker.com/get-docker/) (v20.10 or higher)')

    // An item outdented past the list's first marker continues the list, and a
    // deeper item nests under the one above it.
    const starts = unitWith(sentences, 'This starts:')
    const redis = unitWith(sentences, '**Redis**')
    expect(unitWith(sentences, '**PostgreSQL**')).toMatchObject({ kind: 'item', intro: starts.n })
    expect(redis).toMatchObject({ kind: 'item', depth: 0, intro: starts.n })
    expect(unitWith(sentences, '**SeaweedFS**')).toMatchObject({ kind: 'item', depth: 1, intro: redis.n })

    const rows = ofKind(sentences, 'row').filter((r) => r.heading === 'Docker Compose services')
    expect(rows.map((r) => r.columns)).toEqual(Array(4).fill(['Service', 'Port', 'Description']))
  })

  it('readme: alert markers, html headers and block tags, bold labels introducing lists', () => {
    const sentences = splitDocSentences(fixture('readme.md'))
    expect(sentences.some((u) => u.text.includes('[!IMPORTANT]'))).toBe(false)
    expect(sentences[0]).toMatchObject({ kind: 'prose', heading: null })
    expect(sentences[0]!.text.startsWith('**Repository moved:**')).toBe(true)
    // A quoted line holding two sentences, the first ending inside bold.
    expect(unitWith(sentences, 'Docker Hub stays at').text).toBe('**Docker Hub stays at `amruthpillai/reactive-resume`.**')
    expect(unitWith(sentences, 'GHCR builds now publish').text).toBe('GHCR builds now publish to `ghcr.io/reactive-resume/reactive-resume`.')

    // `<h1>` is a heading, never a sentence; `<p>` is cut off its prose.
    expect(sentences.some((u) => u.text.includes('<h1>'))).toBe(false)
    expect(unitWith(sentences, 'makes it easy to create').text).toBe(
      'Reactive Resume is a free and open-source resume builder that makes it easy to create, update, and share your resume.',
    )
    // A line of badges (tags only) is no sentence; a `·` between two links is no sentence.
    expect(sentences.some((u) => u.text.includes('img.shields.io') || u.text === '·')).toBe(false)

    const label = unitWith(sentences, '**Resume Building**')
    expect(label).toMatchObject({ kind: 'prose', heading: 'Features' })
    expect(unitWith(sentences, 'Live preview as you type')).toMatchObject({ kind: 'item', intro: label.n })
    expect(unitWith(sentences, 'Passkey and two-factor')).toMatchObject({ kind: 'item', intro: unitWith(sentences, '**Extras**').n })
  })

  it('schema catalog: one sentence per table row, header and separator excluded', () => {
    const body = fixture('schema-catalog.md')
    const sentences = splitDocSentences(body)
    const bodyRows = body.split('\n').filter((l) => l.startsWith('| `'))
    const rows = ofKind(sentences, 'row')
    expect(rows.map((r) => r.text)).toEqual(bodyRows)
    expect(rows.find((r) => r.text.startsWith('| `picture.fit`'))?.columns).toEqual([
      'Path',
      'Type',
      'Required',
      'Constraints and default',
      'Description',
    ])
    expect(unitWith(sentences, 'Generated by `pnpm docs:gen`')).toMatchObject({ kind: 'prose', heading: 'Reactive Resume Schema Reference' })
  })

  it('json schema guide: a long block is cut into parts, comments are no sentence', () => {
    const body = fixture('json-resume-schema.mdx')
    const sentences = splitDocSentences(body)
    const parts = ofKind(sentences, 'code').filter((u) => u.heading === 'Complete JSON Schema')
    const lines = body.split('\n')
    const open = lines.findIndex((l) => l.startsWith('```json /schema.json'))
    const close = lines.findIndex((l, i) => i > open && l === '```')
    // The content runs from the line after the fence to the line before its close, in parts of CODE_LINES_PER_SENTENCE.
    const count = Math.ceil((close - open - 1) / CODE_LINES_PER_SENTENCE)
    expect(count).toBeGreaterThan(3)
    expect(parts.map((p) => [p.part, p.parts])).toEqual(Array.from({ length: count }, (_, i) => [i + 1, count]))
    expect(parts.map((p) => [p.startLine, p.endLine])).toEqual(
      Array.from({ length: count }, (_, i) => [open + 2 + i * CODE_LINES_PER_SENTENCE, Math.min(open + 1 + (i + 1) * CODE_LINES_PER_SENTENCE, close)]),
    )
    expect(parts.every((p) => p.lang === 'json')).toBe(true)
    expect(sentences.some((u) => u.text.includes('RESUME-JSON-SCHEMA'))).toBe(false)
  })

  it('design system: the frontmatter beside its description is sentences, cut as a fenced block is', () => {
    const body = fixture('design-system.md')
    const sentences = splitDocSentences(body)
    const front = ofKind(sentences, 'frontmatter')
    // The 44 lines after the description are cut into parts of CODE_LINES_PER_SENTENCE.
    const runParts = Math.ceil(44 / CODE_LINES_PER_SENTENCE)
    expect(front.map((u) => [u.field, u.field === null ? [u.part, u.parts] : null, u.startLine, u.endLine])).toEqual([
      [null, [1, 1], 2, 3],
      ['description', null, 4, 4],
      ...Array.from({ length: runParts }, (_, i) => [
        null,
        [i + 1, runParts],
        5 + i * CODE_LINES_PER_SENTENCE,
        Math.min(4 + (i + 1) * CODE_LINES_PER_SENTENCE, 48),
      ]),
    ])
    expect(front[0]!.text).toBe('version: alpha\nname: Reactive Resume')
    expect(front.every((u) => u.heading === null)).toBe(true)
    // A destructive button's tokens can be cited: the last part holds them, and little else.
    expect(front[front.length - 1]!.text).toContain('button-destructive:\n    backgroundColor: "{colors.destructive}"')
    expect(front[front.length - 1]!.text.split('\n').length).toBeLessThanOrEqual(CODE_LINES_PER_SENTENCE)
    // The prose after the frontmatter numbers on from it.
    expect(sentences[front.length]).toMatchObject({ kind: 'prose', heading: 'Design System', n: front.length + 1 })
  })

  it('page format guide: a title in a tag spread over several lines', () => {
    const sentences = splitDocSentences(fixture('selecting-page-format.mdx'))
    const a4 = unitWith(sentences, 'A4 Format Example')
    expect(a4).toMatchObject({ kind: 'tag', tag: 'Card', attribute: 'title', text: 'A4 Format Example', startLine: 9 })
    expect(sentences[sentences.indexOf(a4) + 1]!.text).toBe('A sample resume in A4 format showing traditional page breaks and constraints.')
    expect(unitWith(sentences, "What if a job posting asks for a 'one-page resume'?")).toMatchObject({ kind: 'tag', tag: 'Accordion' })
  })
})

describe('splitDocSentences edge rules', () => {
  it('a period after an abbreviation or an initial does not end a sentence', () => {
    expect(texts('Connect a client (e.g. Cursor) to the server. Then sign in with J. Smith vs. Jane.')).toEqual([
      'Connect a client (e.g. Cursor) to the server.',
      'Then sign in with J. Smith vs. Jane.',
    ])
  })

  it('a lowercase word after a period continues the sentence', () => {
    expect(texts('Pages are approx. ten. Sizes are 1.5 cm wide.')).toEqual(['Pages are approx. ten.', 'Sizes are 1.5 cm wide.'])
  })

  it('punctuation inside a code span, a link or a tag never ends a sentence', () => {
    expect(texts('Set it to `a. B` now. Read [the docs. Here](https://x.io/a.b) first. Done.')).toEqual([
      'Set it to `a. B` now.',
      'Read [the docs. Here](https://x.io/a.b) first.',
      'Done.',
    ])
    // A code span ending in a period is a literal: the sentence runs on.
    expect(texts('Set the value to `v5.` Then restart.')).toEqual(['Set the value to `v5.` Then restart.'])
  })

  it('a hard line break ends a sentence; a soft one does not', () => {
    expect(texts('**Default:** 30  \n**Maximum:** 100\\\n**Sentence:** seconds<br />\nper request')).toEqual([
      '**Default:** 30',
      '**Maximum:** 100',
      '**Sentence:** seconds',
      'per request',
    ])
    expect(texts('A wrapped\nsentence over\nthree lines.')).toEqual(['A wrapped\nsentence over\nthree lines.'])
  })

  it('comments, ESM blocks, expression lines and breaks are no sentences', () => {
    const body = [
      "import { Card } from '@/components/card'",
      "export const meta = { title: 'x' }",
      '',
      '<!-- a note',
      'over two lines -->',
      '{/* an MDX comment */}',
      '{props.children}',
      '',
      'Kept prose.',
      '',
      '***',
      '',
      'Also kept <!-- inline. Comment --> here.',
    ].join('\n')
    expect(texts(body)).toEqual(['Kept prose.', 'Also kept <!-- inline. Comment --> here.'])
  })

  it('setext underlines and thematic breaks are no sentences; the text above one stays prose', () => {
    expect(texts('Title\n=====\n\nBody text.\n\n---\n\nMore.')).toEqual(['Title', 'Body text.', 'More.'])
  })

  it('an ordered marker other than 1. does not interrupt a paragraph', () => {
    const sentences = splitDocSentences('Released in\n2024. It works.\n\n1. First step\n2. Second step\n')
    expect(sentences.map((u) => [u.kind, u.text])).toEqual([
      ['prose', 'Released in\n2024.'],
      ['prose', 'It works.'],
      ['item', 'First step'],
      ['item', 'Second step'],
    ])
  })

  it('later paragraphs inside an item are sentences, and nested items name their parent', () => {
    const sentences = splitDocSentences('Choose one:\n\n- Plan A\n\n  It costs more. It is faster.\n\n  - Sub option\n- Plan B\n')
    expect(sentences.map((u) => [u.n, u.kind, u.text, u.kind === 'item' ? u.intro : null])).toEqual([
      [1, 'prose', 'Choose one:', null],
      [2, 'item', 'Plan A', 1],
      [3, 'prose', 'It costs more.', null],
      [4, 'prose', 'It is faster.', null],
      [5, 'item', 'Sub option', 2],
      [6, 'item', 'Plan B', 1],
    ])
  })

  it('a list item is cut into sentences: the first carries the marker, each names the list intro', () => {
    const sentences = splitDocSentences(
      'Paging:\n\n- A page holds 20 expenses. Pages start at 1.\n  The last page may be\n  short.\n\n  - Nested under the first sentence.\n- Sorting is newest first.\n',
    )
    expect(sentences.map((u) => [u.n, u.kind, u.text, u.kind === 'item' ? [u.depth, u.intro, u.marker] : null])).toEqual([
      [1, 'prose', 'Paging:', null],
      [2, 'item', 'A page holds 20 expenses.', [0, 1, true]],
      [3, 'item', 'Pages start at 1.', [0, 1, false]],
      [4, 'item', 'The last page may be\n  short.', [0, 1, false]],
      [5, 'item', 'Nested under the first sentence.', [1, 2, true]],
      [6, 'item', 'Sorting is newest first.', [0, 1, true]],
    ])
    // A hard break inside an item ends a sentence as it does in a paragraph.
    expect(texts('- **Default:** 30  \n  **Maximum:** 100\n')).toEqual(['**Default:** 30', '**Maximum:** 100'])
    // Punctuation in a code span stays inside its sentence.
    expect(texts('- Set `a. B` first. Then go.\n')).toEqual(['Set `a. B` first.', 'Then go.'])
  })

  it('a table without outer pipes, and an empty row', () => {
    const sentences = splitDocSentences('Key | Value\n--- | ---\nA | 1\n | \nB | 2\n')
    expect(sentences.map((u) => u.text)).toEqual(['A | 1', 'B | 2'])
    expect(ofKind(sentences, 'row')[0]!.columns).toEqual(['Key', 'Value'])
  })

  it('an empty fenced block is no sentence; an unclosed one runs to the end', () => {
    expect(texts('```\n```\n\nText.')).toEqual(['Text.'])
    expect(splitDocSentences('Text.\n\n~~~yaml\na: 1\n')).toMatchObject([{ kind: 'prose' }, { kind: 'code', lang: 'yaml', text: 'a: 1' }])
  })

  it('a tag line with a label or caption; inline tags stay in their sentence', () => {
    const sentences = splitDocSentences('<Tab label="Docker Compose">\nRun it. <kbd>Ctrl</kbd>+C stops it.\n</Tab>\n<Frame caption="The dock" />')
    expect(sentences.map((u) => [u.kind, u.text])).toEqual([
      ['tag', 'Docker Compose'],
      ['prose', 'Run it.'],
      ['prose', '<kbd>Ctrl</kbd>+C stops it.'],
      ['tag', 'The dock'],
    ])
  })

  it('frontmatter: quoted, escaped, folded; the lines between them a sentence of their own', () => {
    const body =
      "---\ntitle: 'It''s here,\n  over two lines'\nslug: x\n\ntags:\n  - a\ndescription: >-\n  Folded over\n  two lines.\nicon: rocket\n---\n\nBody.\n"
    const sentences = splitDocSentences(body)
    expect(sentences.map((u) => [u.kind, u.kind === 'frontmatter' ? u.field : null, u.text])).toEqual([
      ['frontmatter', 'title', "It''s here,\n  over two lines"],
      ['frontmatter', null, 'slug: x\n\ntags:\n  - a'],
      ['frontmatter', 'description', 'Folded over\n  two lines.'],
      ['frontmatter', null, 'icon: rocket'],
      ['prose', null, 'Body.'],
    ])
    expect(presentSentence(sentences[1]!, sentences, { index: 1, from: 1, to: sentences.length })).toBe('[2] frontmatter:\n    slug: x\n    \n    tags:\n      - a')
  })

  it('holds the exact-slice property on CRLF line endings', () => {
    const body = fixture('getting-started.mdx').replace(/\n/g, '\r\n')
    for (const sentence of splitDocSentences(body)) {
      expect(body.slice(sentence.start, sentence.end)).toBe(sentence.text)
      expect(sentence.text.endsWith('\r')).toBe(false)
    }
  })
})

describe('presentSentence', () => {
  const sentences = splitDocSentences(fixture('quickstart.mdx'))
  const all = { index: 1, from: 1, to: sentences.length }

  it('names a row by its columns', () => {
    const row = ofKind(sentences, 'row').find((r) => r.text.includes('`redis`'))!
    expect(presentSentence(row, sentences, all)).toBe(
      `[${row.n}] row · Service: \`redis\` · Port: 6379 · Description: Redis instance required by the AI Agent workspace`,
    )
  })

  it('points an item at its intro by number in the window, and quotes it from outside', () => {
    const item = unitWith(sentences, '[Docker](https://docs.docker.com/get-docker/)')
    const intro = item.kind === 'item' ? item.intro! : 0
    expect(presentSentence(item, sentences, all)).toBe(`[${item.n}] - ${item.text} (under [${intro}])`)
    expect(presentSentence(item, sentences, { index: 2, from: item.n, to: item.n })).toBe(
      `[${item.n}] - ${item.text} (under "Before you begin, ensure you have the following installed:")`,
    )
  })

  it('shows a later sentence of an item under its intro, without the marker', () => {
    const items = splitDocSentences('Paging:\n\n- A page holds 20 expenses. Pages start at 1.\n  - Nested here. And more.\n')
    const window = { index: 1, from: 1, to: items.length }
    expect(items.map((u) => presentSentence(u, items, window))).toEqual([
      '[1] Paging:',
      '[2] - A page holds 20 expenses. (under [1])',
      '[3]   Pages start at 1. (under [1])',
      '[4]   - Nested here. (under [2])',
      '[5]     And more. (under [2])',
    ])
  })

  it('shows code dedented, with its language, and frontmatter and tags with their field', () => {
    const clone = unitWith(sentences, 'git clone')
    expect(presentSentence(clone, sentences, all)).toBe(
      `[${clone.n}] code (bash):\n    git clone https://github.com/reactive-resume/reactive-resume.git reactive-resume\n    cd reactive-resume`,
    )
    expect(presentSentence(sentences[0]!, sentences, all)).toBe('[1] title: Quickstart')
    const step = unitWith(sentences, 'Create an Account')
    expect(presentSentence(step, sentences, all)).toBe(`[${step.n}] Step title: Create an Account`)
  })
})
