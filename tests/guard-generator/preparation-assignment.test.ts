import { scenarioReviewFingerprint } from '@truecourse/shared/guard-proof-node'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readManifest, loadScenarios, manifestPath } from '@truecourse/guard-runner'
import { GuardGenerateReportSchema, type GuardVerification } from '@truecourse/shared'
import type { WorkerFidelityJudge } from '@truecourse/guard-generator'
import { acceptedSha, extractSessionBy, flowOfAllSession, flowWorkerSessionOf, makeTempRepo, raw, rmrf,
  runGenerate, scenarioYaml, writeCorpus, writeDoc, writeRecipe } from './helpers'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmrf(root) })
const verification: GuardVerification = { scope: 'configuration', method: 'behavior', observable: 'CLI ledger output', cases: [
  { id: 'record', claim: 'The selected record is printed', method: 'behavior', requires: ['process'], conditions: [] },
  { id: 'total', claim: 'The total matches all known records', method: 'behavior', requires: ['process'], conditions: [], preparation: 'controlled' },
] }
const selected = (checks: string[]) => scenarioYaml(raw('Inspect the ledger', checks.map(id => ({ run: ['--version'], milestone: 1, checks: [id], expect: { stdout: { contains: id } } }))))
const judge: WorkerFidelityJudge = async input => {
  const selection = JSON.parse(input.briefing.split('SELECTED CASES: ')[1].split('\n')[0]) as { checks: string[] }[]
  return { kind: 'faithful', evidence: selection.flatMap(p => p.checks.map((caseId, i) => ({ milestone: 1, caseId, steps: [i + 1], reason: 'The output assertion verifies this case.' }))) }
}
function seed(withProfile = false) {
  const root = makeTempRepo(); roots.push(root)
  writeCorpus(root, [{ ref: 'docs/spec.md' }]); writeDoc(root, 'docs/spec.md', '## version\nPrint the selected record and the total of all known records.')
  const program = path.join(root, 'ledger.cjs'); fs.writeFileSync(program, 'console.log("record total")')
  writeRecipe(root, { entry: ['node', program] })
  if (withProfile) {
    const filename = path.join(root, '.truecourse/scenarios/recipe.json')
    const recipe = JSON.parse(fs.readFileSync(filename, 'utf8'))
    fs.writeFileSync(path.join(root, 'prepare.mjs'), 'export {}')
    recipe.preparations = { known: { baseline: 'seeded', scope: 'instance', env: { DATA_FILE: '${directory}/ledger.json' },
      baselineChecks: [{ path: '/rows', counts: { count: 8 } }],
      seed: { script: 'prepare.mjs', provides: { fixtures: {} } }, verify: { script: 'prepare.mjs' } } }
    fs.writeFileSync(filename, JSON.stringify(recipe))
  }
  return root
}
const options = (repoRoot: string) => ({ repoRoot, extractSession: extractSessionBy({ version: [{ claim: 'Print the selected record and the total of all known records.', verification }] }), flowsAreaSession: flowOfAllSession('Inspect ledger') })

describe('case preparation assignment at generation', () => {
  it('blocks only the aggregate sibling, permits ordinary proof, and keeps the full flow incomplete', async () => {
    const root = seed(); let calls = 0
    const result = await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async task => {
      calls++
      const invalid = await task.submitScenario(selected(['record', 'total']), [], judge)
      expect(invalid.isError).toBe(true)
      expect(invalid.content).toContain('outside this worker assignment')
      const accepted = await task.submitScenario(selected(['record']), [], judge)
      const sha = acceptedSha(accepted)!
      expect(sha, accepted.content).toBeTruthy()
      expect(task.validateOutcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] })).toBeUndefined()
      return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
    }) })
    expect(calls).toBe(1)
    expect(result.written).toHaveLength(1)
    const entry = readManifest(root)!.flows[0]
    expect(entry.scenarios[0].caseEvidence?.map(e => e.caseId)).toEqual(['record'])
    expect(entry.generationInputsHash).toBeNull()
    expect(entry.gaps.some(g => g.obligations?.some(o => o.caseId === 'total') && g.blocker?.kind === 'configuration')).toBe(true)
    const report = GuardGenerateReportSchema.parse({ ...result, generatedAt: '2026-09-09T00:00:00Z' })
    expect(report.coverageGaps.some(g => g.milestones?.includes(1) && g.obligations?.some(o => o.caseId === 'total'))).toBe(true)
  })
  it('requires the assigned preparation profile before executing or reviewing aggregate proof', async () => {
    const root = seed(true); const review = vi.fn(judge)
    await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async task => {
      const invalid = await task.submitScenario(selected(['total']), [], review)
      expect(invalid.isError).toBe(true)
      expect(invalid.content).toContain('requires setup.preparation')
      expect(review).not.toHaveBeenCalled()
      return { kind: 'failed', reason: 'Stopped after testing preflight rejection' }
    }) })
    expect(readManifest(root)!.flows[0].scenarios).toHaveLength(0)
  })
})


it('retains prior YAML but revokes proof when its selected private profile disappears', async () => {
  const root = seed(true)
  await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async task => {
    const accepted = await task.submitScenario(selected(['record']), [], judge)
    expect(acceptedSha(accepted), accepted.content).toBeTruthy()
    return { kind: 'failed', reason: 'Stopped after preserving ordinary proof' }
  }) })
  // Model a previously reviewed aggregate scenario. Its flow, source binding and
  // exact review fingerprint remain current; only its preparation disappears.
  const scenario = loadScenarios(root).scenarios[0]
  scenario.setup = { preparation: 'known' }
  scenario.steps[0].checks = ['total']
  if ('run' in scenario.steps[0]) scenario.steps[0].expect = { stdout: { contains: 'total' } }
  const manifest = readManifest(root)!
  const record = manifest.flows[0].scenarios[0]
  record.caseEvidence = [{ milestone: 1, caseId: 'total', steps: [1], reason: 'Independent aggregate assertion' }]
  record.milestoneCoverage = [{ milestone: 1, driver: 'cli', checks: ['total'] }]
  record.reviewedScenarioFingerprint = scenarioReviewFingerprint(scenario)
  const directory = path.join(root, '.truecourse/scenarios')
  const file = fs.readdirSync(directory, { recursive: true }).find(f => String(f).endsWith(`${scenario.id}.yaml`))!
  fs.writeFileSync(path.join(directory, String(file)), JSON.stringify(scenario))
  fs.writeFileSync(manifestPath(root), JSON.stringify(manifest))
  const recipeFile = path.join(directory, 'recipe.json')
  const recipe = JSON.parse(fs.readFileSync(recipeFile, 'utf8'))
  delete recipe.preparations
  fs.writeFileSync(recipeFile, JSON.stringify(recipe))
  await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async task => {
    expect(task.prior?.scenarios).toHaveLength(1)
    return { kind: 'failed', reason: 'Missing profile must be repaired by setup' }
  }) })
  const retained = readManifest(root)!.flows[0]
  expect(retained.scenarios).toHaveLength(1)
  expect(retained.scenarios[0].milestoneCoverage).toBeUndefined()
  expect(retained.generationInputsHash).toBeNull()
  expect(loadScenarios(root).scenarios[0].setup?.preparation).toBe('known')
})
