import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readManifest, loadScenarios } from '@truecourse/guard-runner'
import { type GuardVerification } from '@truecourse/shared'
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
  it('blocks the entire dependent flow when the aggregate preparation is unavailable', async () => {
    const root = seed(); let calls = 0
    const result = await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async () => {
      calls++; return { kind: 'failed', reason: 'Must never author a prefix' }
    }) })
    expect(calls).toBe(0)
    expect(result.written).toHaveLength(0)
    const entry = readManifest(root)!.flows[0]
    expect(entry.scenarios).toHaveLength(0)
    expect(entry.gaps.some(g => g.obligations?.some(o => o.caseId === 'total') && g.blocker?.kind === 'configuration')).toBe(true)
  })
  it('requires the assigned preparation profile before executing or reviewing aggregate proof', async () => {
    const root = seed(true); const review = vi.fn(judge)
    await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async task => {
      const invalid = await task.submitScenario(selected(['record','total']), [], review)
      expect(invalid.isError).toBe(true)
      expect(invalid.content).toContain('requires setup.preparation')
      expect(review).not.toHaveBeenCalled()
      return { kind: 'failed', reason: 'Stopped after testing preflight rejection' }
    }) })
    expect(readManifest(root)!.flows[0].scenarios).toHaveLength(0)
  })
})


it('retains a legacy partial file when setup disappears but never restores its proof', async () => {
  const root = seed(true)
  const initial = { ...options(root), extractSession: extractSessionBy({ version: [{ claim: 'Print the selected record and the total of all known records.', verification: { ...verification, cases: [verification.cases![0]] } }] }) }
  await runGenerate({ ...initial, flowWorkerSession: flowWorkerSessionOf(async task => {
    const report = await task.submitScenario(selected(['record']), [], judge)
    return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: acceptedSha(report)!, expectedReds: [] } }
  }) })
  const before = loadScenarios(root).scenarios[0]
  const recipeFile = path.join(root, '.truecourse/scenarios/recipe.json')
  const recipe = JSON.parse(fs.readFileSync(recipeFile, 'utf8')); delete recipe.preparations
  fs.writeFileSync(recipeFile, JSON.stringify(recipe))
  await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async () => { throw Error('Incomplete flow must not author') }) })
  expect(loadScenarios(root).scenarios.find(s => s.id === before.id)).toEqual(before)
  const current = readManifest(root)!.flows.find(f => !f.orphaned)!
  expect(current.scenarios).toHaveLength(0)
  expect(current.gaps.some(g => g.blocker?.kind === 'configuration')).toBe(true)
})

it('retains the same complete scenario but revokes its proof when only its preparation profile disappears', async () => {
  const root = seed(true)
  fs.cpSync(path.resolve('tests/fixtures/guard-preparation'), path.join(root, 'scripts'), { recursive: true })
  const recipeFile = path.join(root, '.truecourse/scenarios/recipe.json')
  const recipe = JSON.parse(fs.readFileSync(recipeFile, 'utf8'))
  recipe.api = { serve: ['node', 'scripts/server.mjs'], healthPath: '/health' }
  recipe.preparations.known = {
    baseline: 'seeded', scope: 'instance', env: { DATA_FILE: '${directory}/ledger.json' },
    baselineChecks: [{ path: '/rows', credential: 'owner', counts: { count: 8 }, totals: { total: 36 } }],
    seed: { script: 'scripts/seed.mjs', provides: { credentials: { owner: { header: 'x-world-token' } }, fixtures: { inputs: ['count', 'total', 'rows'] } } },
    verify: { script: 'scripts/verify.mjs' }, cleanup: { script: 'scripts/cleanup.mjs' },
  }
  fs.writeFileSync(recipeFile, JSON.stringify(recipe))
  const complete = scenarioYaml(raw('Inspect the ledger', ['record', 'total'].map(id => ({
    run: ['--version'], milestone: 1, checks: [id], expect: { stdout: { contains: id } },
  })), { setup: { preparation: 'known' } }))
  await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async task => {
    const report = await task.submitScenario(complete, [], judge)
    expect(report.isError, report.content).not.toBe(true)
    return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: acceptedSha(report)!, expectedReds: [] } }
  }) })
  const before = readManifest(root)!.flows[0]
  expect(before.scenarios[0].caseEvidence).toHaveLength(2)
  const scenario = loadScenarios(root).scenarios[0]
  delete recipe.preparations
  fs.writeFileSync(recipeFile, JSON.stringify(recipe))
  await runGenerate({ ...options(root), flowWorkerSession: flowWorkerSessionOf(async () => {
    throw Error('A flow without its required preparation must not author')
  }) })
  const retained = readManifest(root)!.flows.find(f => f.flowId === before.flowId)!
  expect(retained.orphaned).not.toBe(true)
  expect(retained.scenarios).toHaveLength(1)
  expect(retained.scenarios[0].milestoneCoverage).toBeUndefined()
  expect(retained.scenarios[0].caseEvidence).toBeUndefined()
  expect(retained.generationInputsHash).toBeNull()
  expect(retained.gaps.some(g => g.blocker?.kind === 'configuration')).toBe(true)
  expect(loadScenarios(root).scenarios.find(s => s.id === scenario.id)).toEqual(scenario)
})
