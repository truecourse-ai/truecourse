import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  mineExampleBlocks,
  exampleFidelityDefect,
  buildAuthorUserPrompt,
  WORKER_CLI_SYSTEM_PROMPT,
  WORKER_API_SYSTEM_PROMPT,
  MAX_EXAMPLE_BLOCKS_PER_SECTION,
  MAX_EXAMPLE_BLOCK_BYTES,
  type AuthorUserContext,
  type DocExampleBlock,
} from '@truecourse/guard-generator'
import type { LlmTurnFn } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  runGenerate,
  turnReply,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('mineExampleBlocks — deterministic, byte-exact fence mining', () => {
  it('extracts the exact bytes between the fences, inner indentation included', () => {
    const section = [
      '## check',
      'Feeding this config in produces the version:',
      '',
      '```txt',
      'line one',
      '    indented line',
      '```',
      'And that is the promise.',
    ].join('\n')
    expect(mineExampleBlocks(section)).toEqual([{ lang: 'txt', content: 'line one\n    indented line' }])
  })

  it('handles tilde fences, longer closing fences, and blocks with no info string', () => {
    const section = ['~~~', 'a: 1', '~~~~~', '', '```json', '{ "x": 1 }', '```'].join('\n')
    expect(mineExampleBlocks(section)).toEqual([
      { content: 'a: 1' },
      { lang: 'json', content: '{ "x": 1 }' },
    ])
  })

  it('an unclosed fence yields nothing — never a half-block', () => {
    expect(mineExampleBlocks(['```', 'dangling', 'text'].join('\n'))).toEqual([])
  })

  it('caps the per-section count and skips oversized blocks', () => {
    const many = Array.from({ length: 6 }, (_, i) => ['```', `block ${i}`, '```'].join('\n')).join('\n')
    expect(mineExampleBlocks(many)).toHaveLength(MAX_EXAMPLE_BLOCKS_PER_SECTION)
    const huge = ['```', 'x'.repeat(MAX_EXAMPLE_BLOCK_BYTES + 1), '```'].join('\n')
    expect(mineExampleBlocks(huge)).toEqual([])
  })
})

describe('exampleFidelityDefect — byte-compare where feasible', () => {
  const BLOCK = 'select *\n  from users\n where id = 1'
  const EXAMPLES: DocExampleBlock[] = [{ lang: 'sql', content: BLOCK, doc: 'docs/x.md', anchor: 'rule' }]
  const cli = (setupFiles: Record<string, string>, stdin?: string) =>
    ({
      driver: 'cli' as const,
      steps: [{ run: ['check'], expect: { exit: 0 }, ...(stdin !== undefined ? { stdin } : {}) }],
      setup: { files: setupFiles },
    })

  it('a byte-exact embedding satisfies the contract', () => {
    expect(exampleFidelityDefect(cli({ 'q.sql': BLOCK }), EXAMPLES)).toBeNull()
    // A single trailing newline is a seeding convention, not a reformat.
    expect(exampleFidelityDefect(cli({ 'q.sql': `${BLOCK}\n` }), EXAMPLES)).toBeNull()
  })

  it('a whitespace-reformatted copy in seeded file content is the defect', () => {
    const defect = exampleFidelityDefect(cli({ 'q.sql': 'select *\nfrom users\nwhere id = 1' }), EXAMPLES)
    expect(defect).toContain('setup.files["q.sql"]')
    expect(defect).toContain('docs/x.md#rule')
    expect(defect).toContain('VERBATIM')
  })

  it('a reformatted copy piped as stdin is the defect too', () => {
    const defect = exampleFidelityDefect(cli({}, 'select * from users where id = 1'), EXAMPLES)
    expect(defect).toContain('stdin')
  })

  it('a reformatted api request body is the defect', () => {
    const defect = exampleFidelityDefect(
      {
        driver: 'api',
        steps: [
          { request: { method: 'POST', path: '/q', body: 'select *  from users  where id = 1' }, expect: { status: 200 } },
        ],
      },
      EXAMPLES,
    )
    expect(defect).toContain('request.body')
  })

  it('an example no carrier resembles constrains nothing', () => {
    expect(exampleFidelityDefect(cli({ 'other.txt': 'entirely different content' }), EXAMPLES)).toBeNull()
  })

  it('a byte-exact embedding anywhere legitimizes derived siblings', () => {
    // The doc's bytes are seeded verbatim; a squashed copy elsewhere is derived
    // content (an excerpt in another input), not a substitute for the example.
    const scenario = cli({ 'q.sql': BLOCK, 'derived.txt': 'select * from users where id = 1' })
    expect(exampleFidelityDefect(scenario, EXAMPLES)).toBeNull()
  })

  it('tiny blocks never enter the comparison — too little content to identify', () => {
    const tiny: DocExampleBlock[] = [{ content: 'true', doc: 'docs/x.md', anchor: 'a' }]
    expect(exampleFidelityDefect(cli({ 'f.txt': 't r u e' }), tiny)).toBeNull()
  })
})

describe('the authoring prompts carry the verbatim-example contract', () => {
  it('both system prompts state the rule', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain("The doc's own examples run VERBATIM")
    expect(WORKER_API_SYSTEM_PROMPT).toContain("The doc's own examples run VERBATIM")
  })

  it('the user prompt renders each mined block clearly bounded', () => {
    const ctx: AuthorUserContext = {
      flow: { id: 'f', title: 'Check the rule', goal: 'the rule fires' },
      milestones: [
        {
          order: 1,
          claim: 'the rule flags the example',
          doc: 'docs/x.md',
          sectionHeading: 'rule',
          sectionText: 'prose',
          realization: [],
          examples: [{ lang: 'sql', content: 'select 1' }],
        },
      ],
      journeyPath: [],
      areaTags: [],
      driver: 'cli',
      recipeEntry: ['node', 'cli.js'],
      recipeBuild: 'true',
    }
    const prompt = buildAuthorUserPrompt(ctx)
    expect(prompt).toContain('DOC EXAMPLE 1.1 (sql)')
    expect(prompt).toContain('<<<DOC-EXAMPLE\nselect 1\nDOC-EXAMPLE>>>')
    // A reformatted copy is caught by the run_scenario validation (draftDefect),
    // whose wording reaches the session through the tool result — not through a
    // one-shot correction block, which no longer exists.
  })
})

describe('generateGuards — the doc example is embedded byte-for-byte end to end', () => {
  const DOC = 'docs/cli.md'
  const BLOCK = 'line one\n    indented line'
  const DOC_CONTENT = [
    '## check',
    'With this exact file as input, `relkit --version` prints the version:',
    '',
    '```txt',
    BLOCK,
    '```',
  ].join('\n')

  it('rejects a reformatted embedding inside the session and commits the exact bytes', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The worker's `run_scenario` tool validates BEFORE it spends a sandbox run:
    // a draft that reformats the doc's example comes back `invalid` with the
    // defect named, and the session's next draft copies the bytes exactly.
    const toolResults: string[] = []
    let drafts = 0
    let openingPrompt = ''
    const turnFn: LlmTurnFn = async (req) => {
      openingPrompt ||= req.messages[0]?.text ?? ''
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'user' && last.text.startsWith('run_scenario result:')) {
        toolResults.push(last.text)
        if (last.text.includes('"verdict": "pass"')) return turnReply({ outcome: { result: 'settled' } })
      }
      // First draft reformats the doc's example (the historical defect); the
      // second copies it byte-for-byte.
      const content = drafts++ === 0 ? 'line one\nindented line' : BLOCK
      return turnReply({
        tool: 'run_scenario',
        args: {
          scenario: {
            title: 'the version prints for the documented input',
            driver: 'cli',
            setup: { files: { 'input.txt': content } },
            steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }],
          },
        },
      })
    }

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({ check: [{ claim: 'the version prints for the documented input' }] }),
      turnFn,
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.written).toHaveLength(1)

    // The session drafted twice: the first came back invalid — no sandbox run —
    // naming exactly the reformatted carrier…
    expect(drafts).toBe(2)
    expect(toolResults[0]).toContain('"verdict": "invalid"')
    expect(toolResults[0]).toContain('setup.files[\\"input.txt\\"]')
    expect(toolResults[0]).toContain(`${DOC}#check`)
    // …and the opening prompt already carried the mined block, byte-exact.
    expect(openingPrompt).toContain('DOC EXAMPLE 1.1 (txt)')
    expect(openingPrompt).toContain(`<<<DOC-EXAMPLE\n${BLOCK}\nDOC-EXAMPLE>>>`)

    // The committed scenario embeds the doc's exact bytes.
    const committed = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as {
      setup: { files: Record<string, string> }
    }
    expect(committed.setup.files['input.txt']).toBe(BLOCK)
  })
})
