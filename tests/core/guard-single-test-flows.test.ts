import { writeGuardRun, readGuardRun, writeGuardEvidence, readGuardEvidence } from '../../packages/core/src/lib/guard-store.js'
import { readGuardRunFlows } from '../../packages/core/src/commands/guard-read.js'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadScenarios, readManifest } from '@truecourse/guard-runner'
import { readFlowsFile, completeRealization, type FlowClaimInput } from '@truecourse/guard-generator'
import { scenarioFullFlowDefect, type GuardFlow } from '@truecourse/shared'
import { acceptedSha, extractSessionBy, faithfulJudge, flowsAreaSessionOf, flowOfAllSession, flowWorkerSessionOf,
  makeTempRepo, raw, rmrf, runGenerate, scenarioYaml, writeCorpus, writeDoc, writeRecipe } from '../guard-generator/helpers.js'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })
const cases = [
  { id: 'details', claim: 'Open expense details' },
  { id: 'cancel', claim: 'Cancel editing without changing the expense' },
  { id: 'save', claim: 'Save editing and observe the expense after reload' },
].map(c => ({ ...c, method: 'behavior' as const, requires: ['process' as const], conditions: [] }))
const verification = { method: 'behavior' as const, scope: 'configuration' as const, observable: 'scripted contract result', cases }
const extract = () => extractSessionBy({ expense: [{ claim: 'Expense behavior', verification }] })
function seed() {
  const repoRoot = makeTempRepo(); repos.push(repoRoot)
  writeCorpus(repoRoot, [{ ref: 'docs/spec.md' }]); writeDoc(repoRoot, 'docs/spec.md', '## expense\nExpense behavior')
  const program = path.join(repoRoot, 'program.cjs'); fs.writeFileSync(program, 'console.log("details cancel save converted cleared missing-key")')
  writeRecipe(repoRoot, { entry: ['node', program] }); return repoRoot
}
const split = () => flowsAreaSessionOf(area => ({ flows: area.claims.flatMap(c => c.verification!.cases!.map(item => ({
  title: item.claim, goal: item.claim, milestones: [{ doc: c.doc, anchor: c.anchor, claimTitle: c.title, caseIds: [item.id] }],
}))), noFlowClaims: [] }))
const worker = (repoRoot: string, onCall?: () => void) => flowWorkerSessionOf(async task => {
  onCall?.()
  const flow = readFlowsFile(repoRoot)?.flows.find(f => f.id === task.flowId)
  // Source flow writes occur before worker execution. Use its immutable selected contract.
  if (!flow) throw Error('Missing synthesized flow')
  const steps = flow.milestones.flatMap(m => m.verification!.cases!.map(c => ({ run: ['--version'], milestone: m.order, checks: [c.id], expect: { stdout: { contains: c.id } } })))
  const report = await task.submitScenario(scenarioYaml(raw(flow.title, steps)), [], async () => ({ kind: 'faithful', evidence: steps.map((s, i) => ({ milestone: s.milestone, caseId: s.checks[0], steps: [i + 1], reason: 'Asserts the scripted source contract output' })) }))
  expect(report.isError, report.content).not.toBe(true)
  return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: acceptedSha(report)!, expectedReds: [] } }
})

describe('single complete test flows through generation and migration', () => {
  it('splits independent source cases, preserves all obligations, and keeps second-run identities with no authoring', async () => {
    const repoRoot = seed(); let calls = 0
    const options = { repoRoot, extractSession: extract(), flowsAreaSession: split(), flowWorkerSession: worker(repoRoot, () => calls++) }
    const first = await runGenerate(options)
    expect(first.written).toHaveLength(3)
    const ids = readFlowsFile(repoRoot)!.flows.map(f => f.id)
    expect(new Set(ids).size).toBe(3)
    expect(readManifest(repoRoot)!.flows.every(f => f.scenarios.length === 1)).toBe(true)
    expect(readFlowsFile(repoRoot)!.flows.flatMap(f => f.milestones.flatMap(m => m.caseIds ?? []))).toEqual(['details','cancel','save'])
    const second = await runGenerate(options)
    expect(second.written).toEqual([])
    expect(calls).toBe(3)
    expect(readFlowsFile(repoRoot)!.flows.map(f => f.id)).toEqual(ids)
  })

  it('retires a superseded generated parent only after all split children settle and preserves historical/manual bytes', async () => {
    const repoRoot = seed()
    await runGenerate({ repoRoot, extractSession: extract(), flowsAreaSession: flowOfAllSession('Expense parent'), flowWorkerSession: worker(repoRoot) })
    const parent = readManifest(repoRoot)!.flows[0]
    const scenario = loadScenarios(repoRoot).scenarios[0]
    const runId = '2026-09-10T00-00-00Z_12345678'
    const evidencePath = await writeGuardEvidence(repoRoot, runId, scenario.id, { 'transcript.txt': 'Original complete parent run evidence' })
    const snapshot = { run: { runId, ranAt: '2026-09-10T00:00:00Z', branch: 'main', commit: 'fixture', recipeFingerprint: 'sha256:recipe' },
      summary: { total: 1, pass: 1, fail: 0, error: 0, blocked: 0, stale: 0, orphaned: 0 },
      scenarios: [{ id: scenario.id, title: scenario.title, flowId: parent.flowId, binds: scenario.binds[0], outcome: 'pass' as const, durationMs: 1, evidencePath }], sections: [] }
    await writeGuardRun(repoRoot, snapshot)
    const before = await readGuardRun(repoRoot, runId)
    const manual = path.join(repoRoot, '.truecourse/scenarios/manual.yaml')
    fs.writeFileSync(manual, JSON.stringify({ ...scenario, id: 'manual', flow: undefined }))
    const manualBefore = fs.readFileSync(manual, 'utf8')
    await runGenerate({ repoRoot, extractSession: extract(), flowsAreaSession: split(), flowWorkerSession: worker(repoRoot) })
    expect(readManifest(repoRoot)!.flows.some(f => f.flowId === parent.flowId)).toBe(false)
    expect(loadScenarios(repoRoot).scenarios.map(s => s.id)).not.toContain(parent.scenarios[0].id)
    expect(readFlowsFile(repoRoot)!.flows.every(f => f.id !== parent.flowId)).toBe(true)
    expect(await readGuardRun(repoRoot, runId)).toEqual(before)
    expect(await readGuardEvidence(repoRoot, runId, scenario.id, 'transcript.txt')).toBe('Original complete parent run evidence')
    expect(await readGuardRunFlows(repoRoot, before)).toEqual([])
    expect(fs.readFileSync(manual, 'utf8')).toBe(manualBefore)
  })

  it('preserves the previous generated corpus when a split cannot produce complete replacements', async () => {
    const repoRoot = seed()
    await runGenerate({ repoRoot, extractSession: extract(), flowsAreaSession: flowOfAllSession('Expense parent'), flowWorkerSession: worker(repoRoot) })
    const parent = readManifest(repoRoot)!.flows[0]
    const before = loadScenarios(repoRoot).scenarios.find(s => s.id === parent.scenarios[0].id)
    await runGenerate({ repoRoot, extractSession: extract(), flowsAreaSession: split(), flowWorkerSession: flowWorkerSessionOf(async () => ({ kind: 'failed', reason: 'Transport unavailable' })) })
    expect(loadScenarios(repoRoot).scenarios.find(s => s.id === parent.scenarios[0].id)).toEqual(before)
    expect(readManifest(repoRoot)!.flows.find(f => f.flowId === parent.flowId)?.orphaned).toBe(true)
    const recovered = await runGenerate({ repoRoot, extractSession: extract(), flowsAreaSession: split(), flowWorkerSession: worker(repoRoot) })
    expect(readManifest(repoRoot)!.flows.some(f => f.flowId === parent.flowId)).toBe(false)
    expect(recovered.retiredScenarios?.some(s => s.id === parent.scenarios[0].id && s.replacedBy?.length === 3)).toBe(true)
  })

  it('keeps live conversion and clearing dependent while absent-key and controlled-response branches stay independent', async () => {
    const repoRoot = seed()
    writeRecipe(repoRoot, { api: { serve: ['node', 'unused.js'], externals: { currencybeacon: { baseUrlEnv: 'CURRENCYBEACON_BASE_URL', env: { CURRENCYBEACON_API_KEY: {} } } } } })
    const live = { ...cases[0], id: 'converted', claim: 'Live conversion succeeds', prerequisites: [{ dependency: 'currencybeacon', mode: 'provided' as const }] }
    const clear = { ...cases[0], id: 'cleared', claim: 'Changing amount clears the successful old conversion', prerequisites: live.prerequisites }
    const missing = { ...cases[0], id: 'missing-key', claim: 'Missing key configuration is shown', prerequisites: [{ dependency: 'currencybeacon', mode: 'absent' as const }] }
    const controlled = { ...cases[0], id: 'controlled', claim: 'Controlled provider error is shown', requires: ['request-control' as const], prerequisites: [] }
    const extraction = extractSessionBy({ expense: [{ claim: 'Conversion behaviors', verification: { ...verification, cases: [live,clear,missing,controlled] } }] })
    const synthesis = flowsAreaSessionOf(area => {
      const c = area.claims[0]
      return { flows: [['converted','cleared'], ['missing-key'], ['controlled']].map(ids => ({ title: ids.join(' then '), goal: ids.join(' then '), milestones: [{ doc: c.doc, anchor: c.anchor, claimTitle: c.title, caseIds: ids }] })), noFlowClaims: [] }
    })
    const called: string[] = []
    await runGenerate({ repoRoot, extractSession: extraction, flowsAreaSession: synthesis, flowWorkerSession: flowWorkerSessionOf(async task => {
      called.push(task.flowId)
      return { kind: 'failed', reason: 'No new test needed for blocker classification' }
    }) })
    expect(called).toEqual(['missing-key'])
    const flows = readManifest(repoRoot)!.flows
    const liveFlow = flows.find(f => f.flowId === 'converted-then-cleared')!
    expect(liveFlow.scenarios).toHaveLength(0)
    expect(liveFlow.milestones![0].caseIds).toEqual(['cleared','converted'])
    expect(liveFlow.gaps.some(g => g.blocker?.dependencies?.includes('currencybeacon'))).toBe(true)
    const controls = flows.find(f => f.flowId === 'controlled')!
    expect(controls.gaps.some(g => g.blocker?.kind === 'unsupported-capability')).toBe(true)
    expect(controls.gaps.some(g => g.blocker?.dependencies?.length)).toBe(false)
  })

  it('requires one supported complete driver, preserving distinct protocol and UI promises', () => {
    const flow = { milestones: [{ order: 1, doc: 'spec.md', anchor: 'state', claimTitle: 'state', proofDrivers: ['api','web'] }] } as GuardFlow
    expect(completeRealization(flow, { surface: 'api', interfaces: [], steps: [{ milestone: 1, interface: {} as never }] })).toBe(true)
    flow.milestones.push({ ...flow.milestones[0], order: 2, proofDrivers: ['web'], claimTitle: 'browser display' })
    expect(completeRealization(flow, { surface: 'api', interfaces: [], steps: [{ milestone: 1, interface: {} as never }] })).toBe(false)
    expect(scenarioFullFlowDefect(flow.milestones, [{ request: { method: 'GET', path: '/' }, milestone: 1, expect: { status: 200 } }] as never)).toContain('milestone 2')
  })
})
