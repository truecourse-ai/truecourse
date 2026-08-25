import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  mineExampleBlocks,
  exampleFidelityDefect,
  buildAuthorUserPrompt,
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  MAX_EXAMPLE_BLOCKS_PER_SECTION,
  MAX_EXAMPLE_BLOCK_BYTES,
  type AuthorUserContext,
  type DocExampleBlock,
} from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  acceptedSha,
  extractSessionBy,
  faithfulJudge,
  flowWorkerSessionOf,
  runGenerate,
  scenarioYaml,
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
    expect(GENERATE_SYSTEM_PROMPT).toContain("The doc's own examples run VERBATIM")
    expect(GENERATE_API_SYSTEM_PROMPT).toContain("The doc's own examples run VERBATIM")
  })

  it('the user prompt renders each mined block clearly bounded, and the correction names the defect', () => {
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
      interfacePath: [],
      areaTags: [],
      driver: 'cli',
      recipeEntry: ['node', 'cli.js'],
      recipeBuild: 'true',
    }
    const prompt = buildAuthorUserPrompt(ctx)
    expect(prompt).toContain('DOC EXAMPLE 1.1 (sql)')
    expect(prompt).toContain('<<<DOC-EXAMPLE\nselect 1\nDOC-EXAMPLE>>>')

    const corrected = buildAuthorUserPrompt({
      ...ctx,
      issues: { uncoveredMilestones: [], unknownMilestones: [], exampleFidelity: 'setup.files["q.sql"] embeds a REFORMATTED copy…' },
    })
    expect(corrected).toContain('reformats a DOC EXAMPLE')
    expect(corrected).toContain('setup.files["q.sql"]')
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

  it('the pre-flight bounces a reformatted embedding, and the exact bytes commit', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let briefing = ''
    const reports: { content: string; isError?: boolean }[] = []
    const scenario = (content: string) =>
      scenarioYaml({
        title: 'the version prints for the documented input',
        setup: { files: { 'input.txt': content } },
        steps: [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }],
      } as never)

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({ check: [{ claim: 'the version prints for the documented input' }] }),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        briefing = await task.prepare()
        // The historical defect: the doc's example reformatted on the way in.
        reports.push(await task.runScenario(scenario('line one\nindented line')))
        const accepted = await task.submitScenario(scenario(BLOCK), [], faithfulJudge)
        reports.push(accepted)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: acceptedSha(accepted)!, expectedReds: [] } }
      }),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.written).toHaveLength(1)

    // The engine bounced the reformatted draft WITHOUT executing it, naming
    // exactly the reformatted carrier…
    expect(reports[0].isError).toBe(true)
    expect(reports[0].content).toContain('pre-flight defect (not executed)')
    expect(reports[0].content).toContain('setup.files["input.txt"]')
    expect(reports[0].content).toContain(`${DOC}#check`)
    // …and the briefing already carried the mined block, byte-exact.
    expect(briefing).toContain('DOC EXAMPLE 1.1 (txt)')
    expect(briefing).toContain(`<<<DOC-EXAMPLE\n${BLOCK}\nDOC-EXAMPLE>>>`)

    // The committed scenario embeds the doc's exact bytes.
    const committed = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as {
      setup: { files: Record<string, string> }
    }
    expect(committed.setup.files['input.txt']).toBe(BLOCK)
  }, 60_000)
})
