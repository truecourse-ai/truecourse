import { afterEach, describe, expect, it } from 'vitest'
import { loadScenarios, readManifest } from '@truecourse/guard-runner'
import type { GuardVerification } from '@truecourse/shared'
import { acceptedSha, extractSessionBy, flowOfAllSession, flowWorkerSessionOf, makeTempRepo, raw, rmrf, runGenerate, scenarioYaml, writeCorpus, writeDoc, writeRecipe } from './helpers.js'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })
const cases: GuardVerification['cases'] = [
  { id: 'exit-zero', claim: 'Version exits successfully', method: 'behavior', requires: ['process'], conditions: [] },
  { id: 'version-text', claim: 'Version prints the release number', method: 'behavior', requires: ['process'], conditions: [] },
]
function seed() {
  const r = makeTempRepo(); repos.push(r); writeRecipe(r); writeCorpus(r, [{ ref: 'docs/spec.md' }])
  writeDoc(r, 'docs/spec.md', '## version\nVersion exits successfully and prints the release number.')
  return r
}
const extracted = () => extractSessionBy({ version: [{ claim: 'Version exits successfully and prints the release number', verification: { scope: 'configuration', method: 'behavior', observable: 'Exit and stdout', cases } }] })
const yamlFor = (id: string) => scenarioYaml(raw('All version behavior', [{ run: ['--version'], milestone: 1, checks: [id], expect: id === 'exit-zero' ? { exit: 0 } : { stdout: { contains: '2.4.1' } } }]))
const evidenceFor = (caseId: string) => ({ kind: 'faithful' as const, evidence: [{ milestone: 1, caseId, steps: [1], reason: 'The assertion observes the selected command output.' }] })

describe('case coverage through generation and persistence', () => {
  it('keeps a reviewed case when a later case blocks, without promising the whole milestone', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, extractSession: extracted(), flowsAreaSession: flowOfAllSession('All version behavior'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const report = await task.submitScenario(yamlFor('exit-zero'), [], async request => {
          expect(request.briefing).toContain('SELECTED CASES')
          return evidenceFor('exit-zero')
        })
        expect(acceptedSha(report), report.content).not.toBeNull()
        return { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'Version text not yet verified' }] } }
      }),
    })
    expect(result.written).toHaveLength(1)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios[0].caseEvidence).toEqual(evidenceFor('exit-zero').evidence)
    expect(entry.scenarios[0].milestoneCoverage).toEqual([{ milestone: 1, driver: 'cli', checks: ['exit-zero'] }])
    expect(entry.generationInputsHash).toBeNull()
    const scenario = loadScenarios(repoRoot).scenarios[0]
    expect(scenario.title).toBe('Version exits successfully')
    expect(scenario.promise).toBe('Version exits successfully')
    expect(entry.gaps.length).toBeGreaterThan(0)
  })

  it('refuses a green candidate whose reviewer omits or misattributes case evidence', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, extractSession: extracted(), flowsAreaSession: flowOfAllSession('All version behavior'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const missing = await task.submitScenario(yamlFor('exit-zero'), [], async () => ({ kind: 'faithful' }))
        expect(missing.isError).toBe(true)
        expect(missing.content).toContain('independent review')
        const invalid = await task.submitScenario(yamlFor('exit-zero'), [], async () => evidenceFor('version-text'))
        expect(invalid.isError).toBe(true)
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'The reviewer did not establish the selected case.' } }
      }),
    })
    expect(result.written).toEqual([])
    expect(loadScenarios(repoRoot).scenarios).toEqual([])
  })

  it('combines two independently reviewed cases of the same milestone', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, extractSession: extracted(), flowsAreaSession: flowOfAllSession('All version behavior'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const first = acceptedSha(await task.submitScenario(yamlFor('exit-zero'), [], async () => evidenceFor('exit-zero')))!
        const secondReport = await task.submitScenario(yamlFor('version-text'), [], async () => evidenceFor('version-text'))
        const second = acceptedSha(secondReport)!
        expect(second, secondReport.content).not.toBeNull()
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: second, expectedReds: [], additionalScenarios: [{ scenarioYamlSha: first, expectedReds: [] }] } }
      }),
    })
    expect(result.written).toHaveLength(2)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.generationInputsHash).not.toBeNull()
    expect(entry.gaps).toEqual([])
    expect(entry.scenarios.flatMap(s => s.caseEvidence!.map(e => e.caseId)).sort()).toEqual(['exit-zero', 'version-text'])
  })
})
