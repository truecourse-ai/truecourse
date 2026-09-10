import { afterEach, describe, expect, it, vi } from 'vitest'
import { readManifest, loadScenarios } from '@truecourse/guard-runner'
import type { GuardVerification } from '@truecourse/shared'
import {
  extractSessionBy,
  flowOfAllSession,
  flowWorkerSessionOf,
  makeTempRepo,
  rmrf,
  runGenerate,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from './helpers.js'
const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

describe('missing prerequisites cannot become expected drift', () => {
  it.each([
    'conversion-rate',
    'converted-value',
    'conversion-format',
    'conversion-display',
    'clear-on-amount',
    'clear-on-currency',
  ])('keeps %s blocked before authoring or faithful-judge override', async (id) => {
    const repoRoot = makeTempRepo()
    repos.push(repoRoot)
    writeCorpus(repoRoot, [{ ref: 'docs/spec.md' }])
    writeDoc(repoRoot, 'docs/spec.md', '## version\nConversion requires a provided CurrencyBeacon account.')
    writeRecipe(repoRoot, {
      api: {
        serve: ['node', 'unused.js'],
        externals: { currencybeacon: { baseUrlEnv: 'CURRENCYBEACON_BASE_URL', env: { CURRENCYBEACON_API_KEY: {} } } },
      },
    })
    const verification: GuardVerification = {
      scope: 'configuration',
      method: 'behavior',
      observable: 'Conversion exists before display or clearing',
      cases: [
        {
          id,
          claim: 'Conversion succeeds first',
          method: 'behavior',
          requires: ['process'],
          conditions: [],
          prerequisites: [{ dependency: 'currencybeacon', mode: 'provided' }],
        },
      ],
    }
    const worker = vi.fn(async () => ({ kind: 'failed' as const, reason: 'must not dispatch' }))
    const result = await runGenerate({
      repoRoot,
      extractSession: extractSessionBy({ version: [{ claim: 'Conversion succeeds first', verification }] }),
      flowsAreaSession: flowOfAllSession('Currency conversion'),
      flowWorkerSession: flowWorkerSessionOf(worker),
    })
    expect(worker).not.toHaveBeenCalled()
    expect(result.written).toEqual([])
    expect(result.coverageGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'blocked-on',
          blocker: expect.objectContaining({ kind: 'configuration', dependencies: ['currencybeacon'] }),
          obligations: [{ milestone: 1, caseId: id }],
        }),
      ]),
    )
    expect(loadScenarios(repoRoot).scenarios).toEqual([])
    expect(readManifest(repoRoot)?.flows[0]?.scenarios).toEqual([])
  })
})

describe('submission precondition eligibility', () => {
  it.each(['blockedPrecondition', 'preparationFailure'] as const)(
    'refuses false drift with %s despite a faithful reviewer',
    async (flag) => {
      const { defaultGuardExecutor } = await import('@truecourse/guard-runner')
      const { faithfulJudge, scenarioYaml, raw, stampMilestones, FAILING_STEPS } = await import('./helpers.js')
      const repoRoot = makeTempRepo()
      repos.push(repoRoot)
      writeRecipe(repoRoot)
      writeCorpus(repoRoot, [{ ref: 'docs/spec.md' }])
      writeDoc(repoRoot, 'docs/spec.md', '## version\nThe command succeeds.')
      const judge = vi.fn(faithfulJudge)
      let refused = ''
      await runGenerate({
        repoRoot,
        extractSession: extractSessionBy({}),
        executor: async (input) => {
          const result = await defaultGuardExecutor(input)
          if (result.status === 'ok')
            for (const row of result.latest.scenarios)
              Object.assign(
                row,
                flag === 'blockedPrecondition'
                  ? { blockedPrecondition: true }
                  : { preparationFailure: { profile: 'fixture', stage: 'prepare' } },
              )
          return result
        },
        flowWorkerSession: flowWorkerSessionOf(async (task) => {
          const report = await task.submitScenario(
            scenarioYaml(stampMilestones(raw('Failure before required setup', FAILING_STEPS), 1)),
            [{ step: 1, predictedActual: 'exit code 7', verdict: 'code-drift', brief: 'Faithful assertion' }],
            judge,
          )
          expect(report.isError).toBe(true)
          refused = report.content
          return { kind: 'failed', reason: 'Setup unresolved' }
        }),
      })
      expect(refused).toContain('establish the prerequisite state')
      expect(judge).not.toHaveBeenCalled()
      expect(loadScenarios(repoRoot).scenarios).toEqual([])
    },
  )
})
