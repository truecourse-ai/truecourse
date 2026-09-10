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
  const complete = () => scenarioYaml(raw('All version behavior', [
    { run: ['--version'], milestone: 1, checks: ['exit-zero'], expect: { exit: 0 } },
    { run: ['--version'], milestone: 1, checks: ['version-text'], expect: { stdout: { contains: '2.4.1' } } },
  ]))
  const fullEvidence = () => ({ kind: 'faithful' as const, evidence: cases!.map((c, i) => ({ milestone: 1, caseId: c.id, steps: [i + 1], reason: 'Asserts the complete command contract' })) })
  it('never publishes one reviewed case as a partial test beneath its flow', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, extractSession: extracted(), flowsAreaSession: flowOfAllSession('All version behavior'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const report = await task.submitScenario(yamlFor('exit-zero'), [], async () => evidenceFor('exit-zero'))
        expect(report.isError).toBe(true)
        expect(acceptedSha(report)).toBeNull()
        return { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'Version text not verified' }] } }
      }) })
    expect(result.written).toEqual([])
    expect(loadScenarios(repoRoot).scenarios).toEqual([])
  })
  it('refuses complete green candidates with missing or misattributed independent evidence', async () => {
    const repoRoot = seed()
    await runGenerate({ repoRoot, extractSession: extracted(), flowsAreaSession: flowOfAllSession('All version behavior'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const missing = await task.submitScenario(complete(), [], async () => ({ kind: 'faithful' }))
        expect(missing.isError).toBe(true)
        expect(missing.content).toContain('independent review')
        const invalid = await task.submitScenario(complete(), [], async () => ({ ...fullEvidence(), evidence: fullEvidence().evidence.map(e => ({ ...e, steps: [99] })) }))
        expect(invalid.isError).toBe(true)
        return { kind: 'failed', reason: 'Review does not establish evidence' }
      }) })
    expect(loadScenarios(repoRoot).scenarios).toEqual([])
  })
  it('refuses two partials then publishes all cases in one reviewed scenario with the complete promise', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, extractSession: extracted(), flowsAreaSession: flowOfAllSession('All version behavior'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        for (const id of ['exit-zero','version-text']) expect(acceptedSha(await task.submitScenario(yamlFor(id), [], async () => evidenceFor(id)))).toBeNull()
        const sha = acceptedSha(await task.submitScenario(complete(), [], async () => fullEvidence()))!
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }) })
    expect(result.written).toHaveLength(1)
    expect(readManifest(repoRoot)!.flows[0].scenarios[0].caseEvidence).toHaveLength(2)
    expect(loadScenarios(repoRoot).scenarios[0].promise).toContain('Version exits successfully')
    expect(loadScenarios(repoRoot).scenarios[0].promise).toContain('Version prints the release number')
  })
})
