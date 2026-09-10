import { afterEach, describe, expect, it } from 'vitest'
import { readManifest, loadScenarios } from '@truecourse/guard-runner'
import { acceptedSha, faithfulJudge, flowOfAllSession, flowWorkerSessionOf, makeTempRepo,
  raw, rmrf, runGenerate, scenarioYaml, writeCorpus, writeDoc, writeRecipe } from './helpers.js'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })
function seed() {
  const r = makeTempRepo(); repos.push(r); writeRecipe(r); writeCorpus(r, [{ ref: 'docs/spec.md' }])
  writeDoc(r, 'docs/spec.md', '## version\nThe CLI reports its version.\n\n## help\nThe CLI explains its usage.')
  return r
}
const yamlFor = (...milestones: number[]) => scenarioYaml(raw('Version and help', milestones.map(milestone => ({ run: ['--version'], milestone, expect: { exit: 0 } }))))

describe('one complete scenario replaces partial flow publication', () => {
  it.each(['blocked', 'retired', 'interrupted'])('publishes no prefix when the worker ends %s', async ending => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const probe = await task.runScenario(yamlFor(1))
        expect(probe.isError).toBeUndefined()
        const partial = await task.submitScenario(yamlFor(1), [], faithfulJudge)
        expect(partial.isError).toBe(true)
        expect(acceptedSha(partial)).toBeNull()
        if (ending === 'interrupted') return { kind: 'failed', reason: 'Transport interrupted' }
        return { kind: 'outcome', outcome: ending === 'blocked'
          ? { kind: 'blocked', perMilestone: [{ order: 2, capability: 'Controlled fixture unavailable' }] }
          : { kind: 'retired', attempts: 1, lastEvidence: 'Whole path could not be verified' } }
      }) })
    expect(result.written).toEqual([])
    expect(loadScenarios(repoRoot).scenarios).toHaveLength(0)
    expect(readManifest(repoRoot)!.flows[0].scenarios).toHaveLength(0)
  })
  it('refuses a union of partials and reviews the immutable complete candidate', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        for (const m of [1,2]) expect(acceptedSha(await task.submitScenario(yamlFor(m), [], faithfulJudge))).toBeNull()
        const sha = acceptedSha(await task.submitScenario(yamlFor(1,2), [], async input => {
          expect(input.briefing).toContain('--- milestone 1')
          expect(input.briefing).toContain('--- milestone 2')
          return faithfulJudge(input)
        }))!
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }) })
    expect(result.written).toHaveLength(1)
    expect(readManifest(repoRoot)!.flows[0].scenarios[0].milestoneCoverage).toHaveLength(2)
  })
  it('retains a complete reviewed candidate after later transport loss', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        expect(acceptedSha(await task.submitScenario(yamlFor(1,2), [], faithfulJudge))).not.toBeNull()
        return { kind: 'failed', reason: 'Transport lost after full acceptance' }
      }) })
    expect(result.written).toHaveLength(1)
    expect(loadScenarios(repoRoot).scenarios[0].steps).toHaveLength(2)
  })
  it('revisions reuse one candidate identity and publish only the final complete test', async () => {
    const repoRoot = seed()
    let first = '', second = ''
    await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        first = acceptedSha(await task.submitScenario(yamlFor(1,2), [], faithfulJudge))!
        const previous = task.stashedYaml(first)!
        second = acceptedSha(await task.submitScenario(yamlFor(1,2).replace('Version and help', 'Complete version and help'), [], faithfulJudge))!
        expect(task.stashedYaml(second)!.match(/^id: (.*)$/m)?.[1]).toBe(previous.match(/^id: (.*)$/m)?.[1])
        expect(task.hasStash(first)).toBe(false)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: second, expectedReds: [] } }
      }) })
    expect(readManifest(repoRoot)!.flows[0].scenarios).toHaveLength(1)
    expect(loadScenarios(repoRoot).scenarios).toHaveLength(1)
  })
  it('does not turn an incomplete expected-red candidate into drift', async () => {
    const repoRoot = seed(); let reviews = 0
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const report = await task.submitScenario(yamlFor(1), [{ step: 1, predictedActual: 'exit 7', verdict: 'code-drift', brief: 'Exit differs' }], async () => { reviews++; return { kind: 'faithful' } })
        expect(report.isError).toBe(true)
        return { kind: 'failed', reason: 'Missing complete proof' }
      }) })
    expect(reviews).toBe(0)
    expect(result.written).toEqual([])
    expect(result.birthFindings).toEqual([])
  })
})
