import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import type { SectionInput } from '@truecourse/guard-generator'
import type { GuardScenario } from '@truecourse/shared'
import { generateGuards } from '@truecourse/guard-generator'
import { buildScenario, serializeScenarioYaml } from '../../packages/guard-generator/src/serialize.js'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, raw, extractBy, authorBy, PASSING_STEPS } from './helpers.js'

const SECTION: SectionInput = {
  doc: 'docs/cli.md',
  anchor: 'fix',
  fingerprint: 'sha256:x',
  headingText: 'fix',
  level: 2,
  ownText: '`fix` rewrites the file in place.',
  fullText: '',
  areaTags: [],
}

describe('buildScenario / serializeScenarioYaml — claim persistence', () => {
  it('stamps the extracted claim onto the built scenario and serializes it', () => {
    const scenario = buildScenario(SECTION, raw('fix rewrites in place', PASSING_STEPS), 'fix.1', 'fix rewrites a fixable file in place')
    expect(scenario.claim).toBe('fix rewrites a fixable file in place')
    const dumped = serializeScenarioYaml(scenario)
    expect(dumped).toContain('claim: fix rewrites a fixable file in place')
    // Round-trips through YAML back to the same claim.
    expect((yaml.load(dumped) as GuardScenario).claim).toBe('fix rewrites a fixable file in place')
  })

  it('writes no claim key when none is threaded (pre-claim scenario)', () => {
    const scenario = buildScenario(SECTION, raw('fix rewrites in place', PASSING_STEPS), 'fix.1')
    expect(scenario.claim).toBeUndefined()
    expect(serializeScenarioYaml(scenario)).not.toContain('claim:')
  })
})

describe('generateGuards — threads ref→claim onto written scenarios', () => {
  const repos: string[] = []
  afterEach(() => {
    while (repos.length) rmrf(repos.pop()!)
  })
  function repo(): string {
    const r = makeTempRepo()
    repos.push(r)
    return r
  }

  const DOC = 'docs/cli.md'
  const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')
  const CLAIM = '`relkit --version` prints the version and exits 0'

  it('persists the extracted claim onto the committed scenario YAML', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({ version: [{ claim: CLAIM, driver: 'cli' }] }),
      generateRunner: authorBy({ version: [raw('relkit prints its version and exits clean', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')
    expect(res.written).toHaveLength(1)
    const written = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as GuardScenario
    expect(written.claim).toBe(CLAIM)
    // The title stays the model's promise wording, distinct from the claim text.
    expect(written.title).toBe('relkit prints its version and exits clean')
  })
})
