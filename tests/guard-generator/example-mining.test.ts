import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { generateGuards } from '@truecourse/guard-generator'
import type { ExtractRunner, GenerateRunner } from '@truecourse/guard-generator'
import type { GuardScenario } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, raw, authored } from './helpers.js'
import { stubAuxRunners } from './helpers.js'

/**
 * Example mining end to end: extraction emits `example`-flavor claims carrying the
 * doc's block verbatim; authoring seeds the block byte-faithfully into the scenario
 * setup; a doc with an incorrect/correct pair yields two scenarios asserting
 * flag / no-flag. The stub extract runner stands in for the LLM read — the pipeline
 * under test is everything downstream (threading, authoring, birth, persist).
 */
describe('example mining — documented example blocks become scenarios (e2e)', () => {
  const repos: string[] = []
  afterEach(() => {
    while (repos.length) rmrf(repos.pop()!)
  })
  function repo(): string {
    const r = makeTempRepo()
    repos.push(r)
    return r
  }

  const DOC = 'docs/lint.md'
  // One section, so extraction binds both example claims to it.
  const DOC_CONTENT = [
    '## ST07',
    '',
    'The following config is an anti-pattern; check flags it:',
    '',
    '```json',
    '{ "strict": true }',
    '```',
    '',
    'This config is valid; check passes clean:',
    '',
    '```json',
    '{ "strict": true, "name": "demo" }',
    '```',
  ].join('\n')

  // The blocks threaded through as example payloads — deliberate internal spacing +
  // a trailing newline, so a byte-faithful path preserves them exactly.
  const INCORRECT = '{ "strict": true }\n'
  const CORRECT = '{ "strict": true, "name": "demo" }\n'

  it('mines an incorrect/correct example pair into two flag/no-flag scenarios, block byte-faithful', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    // Extraction emits two example claims (flavor + verbatim block + outcome), both
    // bound to the doc's ST07 section.
    const extractRunner: ExtractRunner = async ({ outline }) => {
      const target = outline.find((e) => e.headingText === 'ST07') ?? outline[outline.length - 1]
      return {
        claims: [
          {
            claim: 'the anti-pattern config is flagged by check',
            driver: 'cli',
            sectionAnchor: target.anchor,
            reason: 'check exits non-zero',
            flavor: 'example',
            example: { block: INCORRECT, outcome: 'check reports strict mode requires a name (exit 3)' },
          },
          {
            claim: 'the valid config passes check clean',
            driver: 'cli',
            sectionAnchor: target.anchor,
            reason: 'check exits 0',
            flavor: 'example',
            example: { block: CORRECT, outcome: 'check passes clean (exit 0)' },
          },
        ],
      }
    }

    // Authoring seeds each claim's block VERBATIM as the scenario's config file and
    // asserts the documented outcome. It records the block it received so the test
    // can prove the payload reached the author call.
    const received: Array<{ ref: string; block?: string }> = []
    const generateRunner: GenerateRunner = async ({ claims }) => {
      return authored(
        claims.map((c) => {
        received.push({ ref: c.ref, block: c.example?.block })
        const block = c.example?.block ?? '__MISSING__'
        const clean = block.includes('"name"')
          return {
            ref: c.ref,
            scenarios: [
              raw(
                clean ? 'valid config passes check clean' : 'anti-pattern config is flagged by check',
                [{ run: ['check'], expect: { exit: clean ? 0 : 3 } }],
                { setup: { files: { '.relkitrc.json': block } } },
              ),
            ],
          }
        }),
      )
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner, generateRunner })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(2)

    // The example bytes reached the author call for both claims, unmodified.
    expect(received.map((x) => x.block).sort()).toEqual([CORRECT, INCORRECT].sort())

    // Both committed scenarios: load their YAML and map by asserted exit code.
    const scenarios = res.written.map(
      (w) => yaml.load(fs.readFileSync(path.join(r, w.file), 'utf-8')) as GuardScenario,
    )
    const flag = scenarios.find((s) => s.steps[0].expect.exit === 3)
    const noFlag = scenarios.find((s) => s.steps[0].expect.exit === 0)
    expect(flag).toBeDefined()
    expect(noFlag).toBeDefined()

    // Byte-faithful all the way to disk: the setup file content is the doc's block,
    // unchanged (internal spacing + trailing newline preserved).
    expect(flag!.setup?.files?.['.relkitrc.json']).toBe(INCORRECT)
    expect(noFlag!.setup?.files?.['.relkitrc.json']).toBe(CORRECT)

    // The extracted claim rides onto the committed scenario (item 4 persistence).
    expect(flag!.claim).toBe('the anti-pattern config is flagged by check')
  })
})
