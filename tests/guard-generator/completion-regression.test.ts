import fs from 'node:fs'
import path from 'node:path'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { runAgentLoop } from '../../packages/agent-loop/src/index'
import { flowWorkerSessionDef } from '../../packages/core/src/services/guard-generate/flow-worker'
import { memoryPersistence, outcome, stubDriver, type StubCall } from '../core/spec-scan-session-stub'
import { loadScenarios, readManifest, readGuardAutoResolutions } from '@truecourse/guard-runner'
import type { FlowWorkerReview, WorkerFidelityJudge } from '@truecourse/guard-generator'
import type { GuardVerification } from '@truecourse/shared'
import { acceptedSha, extractSessionBy, flowOfAllSession, flowWorkerSessionOf, makeTempRepo, raw, rmrf, runGenerate,
  scenarioYaml, yamlSha, writeCorpus, writeDoc, writeRecipe } from './helpers'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })
const cases = Array.from({ length: 10 }, (_, n) => ({ id: `case-${n}`, claim: `The version output contains case-${n}.`, method: 'behavior' as const,
  requires: ['process' as const], conditions: [] }))
const verification: GuardVerification = { method: 'behavior', scope: 'configuration', observable: 'version output', cases }
const extractSession = () => extractSessionBy({ version: [{ claim: 'All ten version fields are reported.', verification }] })
const yamlFor = (ids: number[]) => scenarioYaml(raw('Selected version fields', ids.map(n => ({ run: ['--version'], milestone: 1,
  checks: [`case-${n}`], expect: { stdout: { contains: `case-${n}` } } }))))
const judge: WorkerFidelityJudge = async input => {
  const selected = JSON.parse(input.briefing.split('SELECTED CASES: ')[1].split('\n')[0]) as { checks: string[] }[]
  return { kind: 'faithful', evidence: selected.flatMap(p => p.checks.map((caseId, i) => ({ milestone: 1, caseId, steps: [i + 1], reason: 'The output assertion checks this required field.' }))) }
}
function seed() {
  const r = makeTempRepo(); repos.push(r); writeCorpus(r, [{ ref: 'docs/spec.md' }])
  writeDoc(r, 'docs/spec.md', '## version\nAll ten version fields are reported.')
  const program = path.join(r, 'program.cjs')
  fs.writeFileSync(program, `console.log(${JSON.stringify(cases.map(c => c.id).join(' '))})`)
  writeRecipe(r, { entry: ['node', program] }); return r
}
async function tool(call: StubCall, name: string, args: unknown) {
  await call.emit({ type: 'assistant-turn', toolCall: { name, args }, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, costSource: 'unpriced' } })
  const result = await call.def.tools.find(t => t.name === name)!.execute(args, { workItem: call.input.workItem, signal: call.input.signal, dispatchChild: call.input.dispatchChild })
  await call.emit({ type: 'tool-result', toolName: name, ...result }); return result
}

describe('generation cannot finish by shrinking selected coverage', () => {
  it('repairs an invalid outcome without accepting partial candidates', async () => {
    const repoRoot = seed()
    const { persistence } = memoryPersistence()
    const result = await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Schema repair'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const { driver } = stubDriver(async call => {
          if (!call.input.resume) {
            await tool(call, 'run_scenario', { yaml: yamlFor([0,1,2,3,4]) })
            const partial = await tool(call, 'submit_scenario', { yaml: yamlFor([0,1,2,3,4]), expectedReds: [] })
            expect(partial.isError).toBe(true)
            expect(acceptedSha(partial)).toBeNull()
            return outcome({ kind: 'blocked', perMilestone: [{ order: 1, capability: 'remaining validation' }], additionalScenarios: [{ scenarioYamlSha: 'fake', expectedReds: [] }] })
          }
          expect(call.briefing).toContain('additionalScenarios')
          const sha = acceptedSha(await tool(call, 'submit_scenario', { yaml: yamlFor([0,1,2,3,4,5,6,7,8,9]), expectedReds: [] }))!
          return outcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] })
        })
        const completion = await runAgentLoop({ def: flowWorkerSessionDef({ task, judgeWith: () => judge }), driver, persistence,
          sessionId: 'schema-incident', workItem: task.workItem, initialMessages: [await task.prepare()] }).outcome
        expect(completion.status, JSON.stringify(completion)).toBe('completed')
        if (completion.status !== 'completed') throw Error(JSON.stringify(completion))
        return { kind: 'outcome', outcome: completion.output }
      }) })
    expect(result.written).toHaveLength(1)
    expect(readManifest(repoRoot)!.flows[0].gaps).toEqual([])
  })

  it('exhausts the existing budget when a worker only rewords retirement', async () => {
    const repoRoot = seed();
    const { persistence } = memoryPersistence();
    await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Retirement refusal'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const { driver, calls } = stubDriver(async call => {
          await call.emit({ type: 'assistant-turn', text: 'retire', usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, costSource: 'unpriced' } });
          return outcome({ kind: 'retired', attempts: 10, lastEvidence: 'A revised explanation does not execute a repair.' });
        });
        const def = flowWorkerSessionDef({ task, judgeWith: () => judge });
        const completion = await runAgentLoop({ def: { ...def, budget: { turns: 2, maxResumes: 0, tokenCeiling: 1000 } }, driver, persistence,
          sessionId: 'retirement-incident', workItem: task.workItem, initialMessages: [await task.prepare()] }).outcome;
        expect(completion).toMatchObject({ status: 'failed', failure: { kind: 'budget-exhausted' } });
        expect(calls.length).toBeLessThanOrEqual(6);
        return { kind: 'failed', reason: 'worker exhausted its original budget' };
      }) });
    expect(readManifest(repoRoot)!.flows[0].generationInputsHash).toBeNull();
  });
  it('refuses both partial halves and accepts one complete replacement', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        for (const ids of [[0,1,2,3,4], [5,6,7,8,9]]) {
          const partial = await task.submitScenario(yamlFor(ids), [], judge)
          expect(partial.isError).toBe(true)
          expect(partial.content).toContain('One complete test')
          expect(acceptedSha(partial)).toBeNull()
        }
        const sha = acceptedSha(await task.submitScenario(yamlFor([0,1,2,3,4,5,6,7,8,9]), [], judge))!
        expect(task.validateOutcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [], additionalScenarios: [{ scenarioYamlSha: sha, expectedReds: [] }] })).toContain('one complete test')
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }) })
    expect(result.written).toHaveLength(1)
    expect(readManifest(repoRoot)!.flows[0].scenarios[0].caseEvidence).toHaveLength(10)
  })

  it('rejects a cached partial or collection and replays only one complete reviewed candidate', async () => {
    const repoRoot = seed()
    let full!: { yaml: string; expectedReds: []; review: FlowWorkerReview }
    const options = { repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version') }
    await runGenerate({ ...options, flowWorkerSession: flowWorkerSessionOf(async task => {
      const sha = acceptedSha(await task.submitScenario(yamlFor([0,1,2,3,4,5,6,7,8,9]), [], judge))!
      full = { yaml: task.stashedYaml(sha)!, expectedReds: [], review: task.stashedReview(sha)! }
      return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
    }) })
    fs.rmSync(path.join(repoRoot, '.truecourse/scenarios/manifest.json'))
    await runGenerate({ ...options, flowWorkerSession: flowWorkerSessionOf(async task => {
      expect(await task.confirmCached([{ ...full, review: undefined }])).toBe(false)
      expect(await task.confirmCached([{ ...full, review: { ...full.review, policyVersion: 3 } }])).toBe(false)
      expect(await task.confirmCached([{ ...full, yaml: yamlFor([0]) }])).toBe(false)
      expect(await task.confirmCached([full, full])).toBe(false)
      expect(await task.confirmCached([full])).toBe(true)
      return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: yamlSha(full.yaml), expectedReds: [] } }
    }) })
    expect(readManifest(repoRoot)!.flows[0].scenarios).toHaveLength(1)
  })

  it('publishes no partial test when the session exhausts its completion budget', async () => {
    const repoRoot = seed()
    const { persistence } = memoryPersistence()
    await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const first = acceptedSha(await task.submitScenario(yamlFor([0, 1, 2, 3, 4]), [], judge))!
        const { driver } = stubDriver(async call => {
          await tool(call, 'run_scenario', { yaml: yamlFor([0]) })
          return outcome({ kind: 'settled', scenarioYamlSha: first || 'unaccepted-candidate', expectedReds: [] })
        })
        const completion = await runAgentLoop({ def: { ...flowWorkerSessionDef({ task, judgeWith: () => judge }),
          budget: { turns: 1, maxResumes: 0, tokenCeiling: 1000 } }, driver, persistence,
          sessionId: 'incomplete-budget', workItem: task.workItem, initialMessages: [await task.prepare()] }).outcome
        expect(completion).toMatchObject({ status: 'failed', failure: { kind: 'budget-exhausted' } })
        return { kind: 'failed', reason: 'budget-exhausted' }
      }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios).toHaveLength(0)
    expect(entry.generationInputsHash).toBeNull()
    expect(entry.gaps.some(g => g.reason.includes('case-5'))).toBe(true)
    expect(persistence.readEvents('incomplete-budget').some(e => e.type === 'outcome')).toBe(false)
  })

  it('keeps a fresh block with no accepted scenarios eligible for generation', async () => {
    const repoRoot = seed()
    let attempts = 0
    for (let n = 0; n < 2; n++) await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async () => {
        attempts++
        return { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'Controlled process fixture unavailable' }] } }
      }) })
    expect(attempts).toBe(2)
    expect(readManifest(repoRoot)!.flows[0].generationInputsHash).toBeNull()
  })

  it.each([false, true])('accounts for a failing test only with current independent review (reviewed=%s)', async reviewed => {
    const repoRoot = seed()
    const broken = yamlFor([0]).replace('contains: case-0', 'contains: expected-but-missing')
    const single = extractSessionBy({ version: [{ claim: 'The version output contains case-0.', verification: { ...verification, cases: [cases[0]] } }] })
    await runGenerate({ repoRoot, extractSession: single, flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const probe = await task.submitScenario(broken, [], judge)
        const predictedActual = /actual:\s+(.*)/.exec(probe.content)?.[1] ?? ''
        const expectedReds = [{ step: 1, predictedActual, verdict: 'code-drift' as const, brief: 'Required output is missing' }]
        const accepted = await task.submitScenario(broken, expectedReds, reviewed ? judge : async () => ({ kind: 'unavailable', reason: 'Review transport lost' }))
        const sha = acceptedSha(accepted)!
        expect(!!sha).toBe(reviewed)
        expect(task.validateOutcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds }) === undefined).toBe(reviewed)
        return { kind: 'outcome', outcome: reviewed ? { kind: 'settled', scenarioYamlSha: sha, expectedReds } :
          { kind: 'blocked', perMilestone: [{ order: 1, capability: 'Independent review unavailable' }] } }
      }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios).toHaveLength(reviewed ? 1 : 0)
    if (reviewed) expect(entry.scenarios[0].status).toBe('failing')
    expect(entry.generationInputsHash !== null).toBe(reviewed)
    expect(entry.scenarios[0]?.caseEvidence?.length ?? 0).toBe(reviewed ? 1 : 0)
  })

  it.each(['evidence', 'binding'])('does not restore invalid retained prior proof at persistence (%s)', async defect => {
    const repoRoot = seed()
    const options = { repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version') }
    await runGenerate({ ...options, flowWorkerSession: flowWorkerSessionOf(async task => {
      const sha = acceptedSha(await task.submitScenario(yamlFor([0,1,2,3,4,5,6,7,8,9]), [], judge))!
      return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
    }) })
    const manifest = readManifest(repoRoot)!
    manifest.flows[0].generationInputsHash = null
    if (defect === 'evidence') manifest.flows[0].scenarios[0].caseEvidence = []
    else {
      const scenario = loadScenarios(repoRoot).scenarios[0]
      scenario.binds[0].fingerprint = 'sha256:stale'
      const relative = fs.readdirSync(path.join(repoRoot, '.truecourse/scenarios'), { recursive: true }).find(p => String(p).endsWith(`${scenario.id}.yaml`))!
      fs.writeFileSync(path.join(repoRoot, '.truecourse/scenarios', String(relative)), JSON.stringify(scenario))
    }
    fs.writeFileSync(path.join(repoRoot, '.truecourse/scenarios/manifest.json'), JSON.stringify(manifest))
    await runGenerate({ ...options, flowWorkerSession: flowWorkerSessionOf(async task => {
      expect(await task.prepare()).toContain('case-0')
      return { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'Fixture unavailable for renewed review' }] } }
    }) })
    const retained = readManifest(repoRoot)!.flows[0]
    expect(retained.scenarios).toHaveLength(1)
    expect(retained.scenarios[0].milestoneCoverage).toBeUndefined()
    expect(retained.generationInputsHash).toBeNull()
  })

  it('persists the last replacement when the same YAML is accepted again after an intervening edit', async () => {
    const repoRoot = seed()
    const options = { repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version') }
    await runGenerate({ ...options, flowWorkerSession: flowWorkerSessionOf(async task => {
      await task.submitScenario(yamlFor([0,1,2,3,4,5,6,7,8,9]), [], judge)
      return { kind: 'failed', reason: 'Interrupted after acceptance' }
    }) })
    await runGenerate({ ...options, flowWorkerSession: flowWorkerSessionOf(async task => {
      const id = task.prior!.scenarios[0].id
      const a = acceptedSha(await task.submitScenario(yamlFor([0,1,2,3,4,5,6,7,8,9]), [], judge, id))!
      await task.submitScenario(yamlFor([0]), [], judge, id)
      const last = acceptedSha(await task.submitScenario(yamlFor([0,1,2,3,4,5,6,7,8,9]), [], judge, id))!
      expect(last).toBe(a)
      expect(task.validateOutcome({ kind: 'settled', scenarioYamlSha: last, expectedReds: [] })).toBeUndefined()
      return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: last, expectedReds: [] } }
    }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios).toHaveLength(1)
    expect(entry.scenarios[0].caseEvidence).toHaveLength(10)
    expect(entry.generationInputsHash).not.toBeNull()
    expect(loadScenarios(repoRoot).scenarios[0].steps).toHaveLength(10)
  })

  it('refuses missing first-review evidence and never reuses old evidence for a same-ID revision', async () => {
    const repoRoot = seed()
    const original = yamlFor([0,1,2,3,4,5,6,7,8,9])
    const revised = original.replace('contains: case-0', 'matches: case-0')
    await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const missing = await task.submitScenario(original, [], async () => ({ kind: 'faithful' }))
        expect(missing.isError).toBe(true)
        expect(missing.content).toContain('not a semantic fidelity rejection')
        expect(acceptedSha(missing)).toBeNull()
        const sha = acceptedSha(await task.submitScenario(original, [], judge))!
        const acceptedYaml = task.stashedYaml(sha)!
        const id = (load(acceptedYaml) as { id: string }).id
        const rejected = await task.submitScenario(revised, [], async input => {
          expect(input.briefing).toContain(`id: ${id}`)
          expect(input.briefing).toContain('matches: case-0')
          return { kind: 'faithful' }
        })
        expect(rejected.isError).toBe(true)
        expect(rejected.content).toContain('not a semantic fidelity rejection')
        expect(acceptedSha(rejected)).toBeNull()
        expect(task.hasStash(sha)).toBe(true)
        expect(task.stashedYaml(sha)).toBe(acceptedYaml)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios).toHaveLength(1)
    expect(entry.scenarios[0].caseEvidence).toHaveLength(10)
    expect(loadScenarios(repoRoot).scenarios[0].steps[0]).toMatchObject({ expect: { stdout: { contains: 'case-0' } } })
  })

  it('requires changed complete submissions after review correction', async () => {
    const repoRoot = seed()
    const single = extractSessionBy({ version: [{ claim: 'Two required fields.', verification: { ...verification, cases: cases.slice(0, 2) } }] })
    await runGenerate({ repoRoot, extractSession: single, flowsAreaSession: flowOfAllSession('Current remainder'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const refusal = await task.submitScenario(yamlFor([0,1]), [], async () => ({ kind: 'flagged', confidence: 'low', mismatch: 'Required baseline is not established.' }))
        expect(refusal.isError).toBe(true)
        const stale = { kind: 'retired' as const, attempts: 2, lastEvidence: 'Old explanation.' }
        expect(task.validateOutcome(stale)).toContain('Required baseline')
        await task.submitScenario(yamlFor([0,1]), [], async () => ({ kind: 'flagged', confidence: 'low', mismatch: 'Required baseline is not established.' }))
        expect(task.validateOutcome(stale)).toContain('repair submission')
        const partial = await task.submitScenario(yamlFor([1]), [], judge)
        expect(acceptedSha(partial)).toBeNull()
        const repaired = yamlFor([0,1]).replace('contains: case-0', 'matches: case-0')
        const sha = acceptedSha(await task.submitScenario(repaired, [], judge))!
        expect(task.validateOutcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] })).toBeUndefined()
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }) })
    expect(readManifest(repoRoot)!.flows[0].scenarios).toHaveLength(1)
  })

  it('repairs invalid review annotations without producing a semantic fidelity finding', async () => {
    const repoRoot = seed()
    const single = extractSessionBy({ version: [{ claim: cases[0].claim, verification: { ...verification, cases: [cases[0]] } }] })
    const result = await runGenerate({ repoRoot, extractSession: single, flowsAreaSession: flowOfAllSession('Annotation repair'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const wrong = await task.submitScenario(yamlFor([0]), [], async () => ({ kind: 'faithful',
          evidence: [{ milestone: 1, caseId: 'case-0', steps: [99], reason: 'Wrong reference' }] }))
        expect(wrong.isError).toBe(true)
        expect(wrong.content).toContain('not a semantic fidelity rejection')
        const sha = acceptedSha(await task.submitScenario(yamlFor([0]), [], judge))!
        expect(task.validateOutcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds: [] })).toBeUndefined()
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }) })
    expect(result.birthFindings ?? []).toEqual([])
    expect(readManifest(repoRoot)!.flows[0].generationInputsHash).not.toBeNull()
  })

  it.each(['annotation', 'review-unavailable'])('retires %s work without a semantic taint or auto-resolution penalty', async reason => {
    const repoRoot = seed()
    const single = extractSessionBy({ version: [{ claim: cases[0].claim, verification: { ...verification, cases: [cases[0]] } }] })
    await runGenerate({ repoRoot, extractSession: single, flowsAreaSession: flowOfAllSession('Unavailable review'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        await task.submitScenario(yamlFor([0]), [], async () => reason === 'annotation'
          ? { kind: 'faithful', evidence: [{ milestone: 1, caseId: 'case-0', steps: [99], reason: 'Invalid reference' }] }
          : { kind: 'unavailable', reason: 'Review citations exhausted their bounded correction budget.' })
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'Review could not complete.' } }
      }) })
    const ledger = readGuardAutoResolutions(repoRoot)
    expect(Object.keys(ledger.tainted)).toEqual([])
    expect(Object.keys(ledger.entries)).toEqual([])
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.generationInputsHash).toBeNull()
    expect(entry.gaps[0].reason).toContain(reason)
    if (reason === 'review-unavailable') expect(entry.scenarios).toHaveLength(0)
  })

  it('drops an obsolete execution failure after a corrected passing probe without counting it as reviewed proof', async () => {
    const repoRoot = seed()
    const single = extractSessionBy({ version: [{ claim: cases[0].claim, verification: { ...verification, cases: [cases[0]] } }] })
    await runGenerate({ repoRoot, extractSession: single, flowsAreaSession: flowOfAllSession('Probe repair'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        expect((await task.runScenario(yamlFor([0]).replace('contains: case-0', 'contains: expected-but-missing'))).isError).toBe(true)
        expect((await task.runScenario(yamlFor([0]))).isError).toBeUndefined()
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'Stopped before independent review.' } }
      }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios).toHaveLength(0)
    expect(entry.generationInputsHash).toBeNull()
    expect(entry.gaps[0].reason).toContain('not-attempted')
    expect(entry.gaps[0].reason).not.toContain('expected-but-missing')
    expect(readGuardAutoResolutions(repoRoot).tainted).toEqual({})
  })

})
