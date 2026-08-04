/**
 * Per-step env through the generate pipeline: a model-authored cli scenario whose
 * steps carry their own `env` overlay must survive authoring → birth → commit, and
 * birth must actually RUN the overlay (a step that asserts an env the world does not
 * have dies at birth, exactly like any other unmet claim).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { GuardScenarioSchema, type GuardScenario } from '@truecourse/shared'
import { loadScenarios } from '@truecourse/guard-runner'
import type { GenerateRunner, RawGeneratedScenario } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeCorpus,
  writeDoc,
  raw,
  extractBy,
  runGenerate,
  stampMilestones,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## telemetry',
  '`relkit env MODE` prints `MODE=(unset)` by default, and `MODE=ci` when `MODE` is set in the environment.',
].join('\n')

/** A repo whose one testable section claims behaviour under TWO environments. */
function seed(): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

/** An author that returns the given steps for whatever flow it is asked about. */
function authoring(steps: RawGeneratedScenario['steps']): GenerateRunner {
  return async (ctx) => ({
    scenario: stampMilestones(raw('telemetry status under two environments', steps), ctx.milestones.length),
  })
}

describe('generateGuards — per-step env', () => {
  it('births and commits a scenario that observes one command under two environments', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authoring([
        { run: ['env', 'MODE'], expect: { exit: 0, stdout: { equals: 'MODE=(unset)\n' } } },
        { run: ['env', 'MODE'], env: { MODE: 'ci' }, expect: { exit: 0, stdout: { equals: 'MODE=ci\n' } } },
      ]),
    })

    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.birthPassed).toBe(1)
    expect(res.written).toHaveLength(1)

    // The overlay survives serialization and re-parses under the strict schema.
    const committed = loadScenarios(r).scenarios[0] as GuardScenario
    expect(() => GuardScenarioSchema.parse(committed)).not.toThrow()
    if (committed.driver !== 'cli') throw new Error('expected a cli scenario')
    expect(committed.steps[0].env).toBeUndefined()
    expect(committed.steps[1].env).toEqual({ MODE: 'ci' })
  })

  it('birth runs the overlay for real: a step asserting an env nobody declared fails', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      // The env is declared on step 1, but step 2 — with no overlay of its own —
      // asserts it too. It must NOT leak, so birth fails on step 2.
      generateRunner: authoring([
        { run: ['env', 'MODE'], env: { MODE: 'ci' }, expect: { exit: 0, stdout: { equals: 'MODE=ci\n' } } },
        { run: ['env', 'MODE'], expect: { exit: 0, stdout: { equals: 'MODE=ci\n' } } },
      ]),
    })

    // The test is committed red — the disagreement is real, so it stays visible.
    expect(res.written).toMatchObject([{ status: 'failing' }])
    expect(res.birthFindings).toHaveLength(1)
    // Step 2 saw the bare scenario env — the overlay expired with step 1.
    expect(res.birthFindings[0].actual).toContain('MODE=(unset)')
    expect(res.birthFindings[0].stdout).toContain('MODE=(unset)')
  })
})
