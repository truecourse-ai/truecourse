import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  FIDELITY_SYSTEM_PROMPT,
} from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  runGenerate,
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

describe('two-sided promises — the rule rides all three prompts (G15)', () => {
  it('both authoring prompts require steps for BOTH halves of a two-sided claim', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# Two-sided promises get two-sided tests')
    expect(GENERATE_SYSTEM_PROMPT).toContain('steps for BOTH halves')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('# Two-sided promises get two-sided tests')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('steps for BOTH halves')
  })

  it('the fidelity reviewer flags a one-sided scenario weak on the same criterion', () => {
    expect(FIDELITY_SYSTEM_PROMPT).toContain('# Two-sided claims — both halves must be asserted')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('the negative half is never verified')
  })

  it('the rule slices carry no repo-specific token — general, tool-agnostic phrasing', () => {
    // Overfit guard (ported from the pre-squash slice tests): the rule must speak
    // in classes of behavior, never in the vocabulary of a battle-test target.
    for (const prompt of [GENERATE_SYSTEM_PROMPT, GENERATE_API_SYSTEM_PROMPT, FIDELITY_SYSTEM_PROMPT]) {
      const slice = prompt.slice(prompt.indexOf('Two-sided'))
      const section = slice.slice(0, slice.indexOf('\n#'))
      for (const token of ['relkit', 'todos', 'semver', 'sqlfluff']) {
        expect(section).not.toContain(token)
      }
    }
  })
})

describe('two-sided promises — the negative half SURVIVES the pipeline (G15 regression)', () => {
  const DOC = 'docs/cli.md'
  const DOC_CONTENT = [
    '## strictness',
    'A valid invocation is accepted (exit 0); an invalid one is rejected with',
    '`fatal:` on stderr and a non-zero exit.',
  ].join('\n')

  it('a scenario realizing one milestone with BOTH halves commits with both steps intact', async () => {
    // The historical failure mode: the negative half was silently dropped and the
    // committed test stayed green when rejection logic broke. This pins the
    // engine's half of the fix — a milestone realized by SEVERAL steps (the
    // accepted invocation AND the rejected one, both annotated with the same
    // milestone) passes authoring validation, births green against the real
    // fixture, and lands in the corpus with the rejection step INTACT.
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const twoSided = raw('valid invocations are accepted and invalid ones are rejected', [
      { run: ['--version'], expect: { exit: 0 }, milestone: 1 },
      // The NEGATIVE half: the rejected input, its exclusion asserted observably
      // (the distinct exit code and the rejection line).
      { run: ['boom'], expect: { exit: 7, stderr: { contains: 'fatal:' } }, milestone: 1 },
    ])

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({
        strictness: [{ claim: 'valid invocations are accepted and invalid ones are rejected' }],
      }),
      generateRunner: authorBy({ strictness: twoSided }),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)
    expect(res.written[0].status).toBe('passing')

    // The committed YAML carries BOTH halves, in order, on the SAME milestone.
    const committed = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as {
      steps: { run: string[]; milestone?: number; expect: { exit?: number; stderr?: { contains?: string } } }[]
    }
    expect(committed.steps).toHaveLength(2)
    expect(committed.steps[0]).toMatchObject({ run: ['--version'], milestone: 1 })
    expect(committed.steps[1]).toMatchObject({
      run: ['boom'],
      milestone: 1,
      expect: { exit: 7, stderr: { contains: 'fatal:' } },
    })

    // And the flow settled — a two-sided realization is a complete one.
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'strictness')!.scenarios).toEqual([
      { id: 'strictness.cli.1', drivers: ['cli'], status: 'passing' },
    ])
  })
})
