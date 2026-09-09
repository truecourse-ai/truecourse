import fs from 'node:fs'
import path from 'node:path'
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
  it('repairs blocked/additionalScenarios schema errors without losing accepted portions', async () => {
    const repoRoot = seed();
    const { persistence } = memoryPersistence();
    let first = '';
    const result = await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Schema repair'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const { driver } = stubDriver(async call => {
          if (!call.input.resume) {
            await tool(call, 'run_scenario', { yaml: yamlFor([0, 1, 2, 3, 4]) });
            first = acceptedSha(await tool(call, 'submit_scenario', { yaml: yamlFor([0, 1, 2, 3, 4]), expectedReds: [] }))!;
            return outcome({ kind: 'blocked', perMilestone: [{ order: 1, capability: 'remaining validation' }],
              additionalScenarios: [{ scenarioYamlSha: first, expectedReds: [] }] });
          }
          expect(call.briefing).toContain('additionalScenarios');
          expect(call.briefing).toContain('must not carry');
          expect(task.hasStash(first)).toBe(true);
          const second = acceptedSha(await tool(call, 'submit_scenario', { yaml: yamlFor([5, 6, 7, 8, 9]), expectedReds: [] }))!;
          return outcome({ kind: 'settled', scenarioYamlSha: second, expectedReds: [], additionalScenarios: [{ scenarioYamlSha: first, expectedReds: [] }] });
        });
        const completion = await runAgentLoop({ def: flowWorkerSessionDef({ task, judgeWith: () => judge }), driver, persistence,
          sessionId: 'schema-incident', workItem: task.workItem, initialMessages: [await task.prepare()] }).outcome;
        expect(completion.status, JSON.stringify(completion)).toBe('completed');
        if (completion.status !== 'completed') throw Error(JSON.stringify(completion));
        return { kind: 'outcome', outcome: completion.output };
      }) });
    expect(result.written).toHaveLength(2);
    expect(readManifest(repoRoot)!.flows[0].gaps).toEqual([]);
  });
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
  it('keeps the accepted half, refuses settled, and finishes with the other half in the same session', async () => {
    const repoRoot = seed(); let first = ''; let resumed = 0
    const { persistence } = memoryPersistence()
    const result = await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const { driver } = stubDriver(async call => {
          if (!call.input.resume) {
            const wrong = await tool(call, 'run_scenario', { yaml: yamlFor([0]).replace('contains: case-0', 'contains: missing-announcement') })
            expect(wrong.isError).toBe(true)
            const rejected = await task.submitScenario(yamlFor([0, 1, 2, 3, 4, 5]), [], async () => ({ kind: 'flagged', confidence: 'high', mismatch: 'Case 5 lacks its required assertion.' }))
            expect(rejected.isError).toBe(true)
            const partial = await tool(call, 'submit_scenario', { yaml: yamlFor([0, 1, 2, 3, 4]), expectedReds: [] })
            first = acceptedSha(partial)!
            expect(partial.content).toContain('5/10')
            expect(partial.content).toContain('case-5')
            expect(partial.content).toContain('Case 5 lacks its required assertion.')
            expect(partial.content).not.toContain('Finish with:')
            return outcome({ kind: 'settled', scenarioYamlSha: first, expectedReds: [] })
          }
          resumed++
          expect(call.briefing).toContain('case-5')
          expect(call.briefing).toContain('case-9')
          const second = acceptedSha(await tool(call, 'submit_scenario', { yaml: yamlFor([5, 6, 7, 8, 9]), expectedReds: [] }))!
          return outcome({ kind: 'settled', scenarioYamlSha: second, expectedReds: [], additionalScenarios: [{ scenarioYamlSha: first, expectedReds: [] }] })
        })
        const completion = await runAgentLoop({ def: flowWorkerSessionDef({ task, judgeWith: () => judge }), driver, persistence,
          sessionId: 'incident-replay', workItem: task.workItem, initialMessages: [await task.prepare()] }).outcome
        expect(completion.status).toBe('completed')
        if (completion.status !== 'completed') throw new Error(JSON.stringify(completion))
        return { kind: 'outcome', outcome: completion.output }
      }),
    })
    expect(resumed).toBe(1)
    expect(result.written).toHaveLength(2)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.gaps).toEqual([])
    expect(entry.scenarios.flatMap(s => s.caseEvidence ?? [])).toHaveLength(10)
    expect(entry.generationInputsHash).not.toBeNull()
    expect(persistence.readEvents('incident-replay').filter(e => e.type === 'outcome')).toHaveLength(1)
  })

  it('rejects a cached partial green without losing its current reviewed full cache counterpart', async () => {
    const repoRoot = seed()
    let partial: { yaml: string; expectedReds: []; review: FlowWorkerReview } | undefined
    let full: typeof partial
    await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const sha = acceptedSha(await task.submitScenario(yamlFor([0, 1, 2, 3, 4]), [], judge))!
        partial = { yaml: task.stashedYaml(sha)!, expectedReds: [], review: task.stashedReview(sha)! }
        const second = acceptedSha(await task.submitScenario(yamlFor([5, 6, 7, 8, 9]), [], judge))!
        full = { yaml: task.stashedYaml(second)!, expectedReds: [], review: task.stashedReview(second)! }
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: second, expectedReds: [], additionalScenarios: [{ scenarioYamlSha: sha, expectedReds: [] }] } }
      }) })
    fs.rmSync(path.join(repoRoot, '.truecourse/scenarios/manifest.json'))
    await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        expect(await task.confirmCached([{ ...partial!, review: undefined }])).toBe(false)
        expect(await task.confirmCached([partial!])).toBe(false)
        expect(await task.confirmCached([{ ...partial!, yaml: partial!.yaml.replace('case-0', 'different') }, full!])).toBe(false)
        expect(await task.confirmCached([partial!, full!])).toBe(true)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: yamlSha(full!.yaml), expectedReds: [],
          additionalScenarios: [{ scenarioYamlSha: yamlSha(partial!.yaml), expectedReds: [] }] } }
      }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios.flatMap(s => s.caseEvidence ?? [])).toHaveLength(10)
  })
  it('preserves the accepted half when the session exhausts its completion budget', async () => {
    const repoRoot = seed()
    const { persistence } = memoryPersistence()
    await runGenerate({ repoRoot, extractSession: extractSession(), flowsAreaSession: flowOfAllSession('Complete version'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const first = acceptedSha(await task.submitScenario(yamlFor([0, 1, 2, 3, 4]), [], judge))!
        const { driver } = stubDriver(async call => {
          await tool(call, 'run_scenario', { yaml: yamlFor([0]) })
          return outcome({ kind: 'settled', scenarioYamlSha: first, expectedReds: [] })
        })
        const completion = await runAgentLoop({ def: { ...flowWorkerSessionDef({ task, judgeWith: () => judge }),
          budget: { turns: 1, maxResumes: 0, tokenCeiling: 1000 } }, driver, persistence,
          sessionId: 'incomplete-budget', workItem: task.workItem, initialMessages: [await task.prepare()] }).outcome
        expect(completion).toMatchObject({ status: 'failed', failure: { kind: 'budget-exhausted' } })
        return { kind: 'failed', reason: 'budget-exhausted' }
      }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios).toHaveLength(1)
    expect(entry.scenarios[0].caseEvidence).toHaveLength(5)
    expect(entry.generationInputsHash).toBeNull()
    expect(entry.gaps[0].reason).toContain('case-5')
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
        expect(sha, accepted.content).not.toBeNull()
        expect(task.validateOutcome({ kind: 'settled', scenarioYamlSha: sha, expectedReds }) === undefined).toBe(reviewed)
        return { kind: 'outcome', outcome: reviewed ? { kind: 'settled', scenarioYamlSha: sha, expectedReds } :
          { kind: 'blocked', perMilestone: [{ order: 1, capability: 'Independent review unavailable' }] } }
      }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios[0].status).toBe('failing')
    expect(entry.scenarios[0].reviewed === false).toBe(!reviewed)
    expect(entry.generationInputsHash !== null).toBe(reviewed)
    expect(entry.scenarios[0].caseEvidence?.length ?? 0).toBe(reviewed ? 1 : 0)
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

  it('requires changed submissions after correction and preserves independent accepted cases', async () => {
    const repoRoot = seed()
    const single = extractSessionBy({ version: [{ claim: 'Two independent required fields.', verification: { ...verification, cases: cases.slice(0, 2) } }] })
    await runGenerate({ repoRoot, extractSession: single, flowsAreaSession: flowOfAllSession('Current remainder'),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const refusal = await task.submitScenario(yamlFor([0]), [], async () => ({ kind: 'flagged', confidence: 'low',
          mismatch: 'Cancel leaves Amount blank, so the form cannot save even with a broken Cancel handler.' }))
        expect(refusal.isError).toBe(true)
        const stale = { kind: 'retired' as const, attempts: 2, lastEvidence: 'An old total changed.' }
        const feedback = task.validateOutcome(stale)!
        expect(feedback).toContain('Cancel leaves Amount blank')
        expect(feedback).toContain('case-1')
        expect(task.validateOutcome(stale)).toContain('repair submission')
        await task.submitScenario(yamlFor([0]), [], async () => ({ kind: 'flagged', confidence: 'low', mismatch: 'Same invalid cancellation, reviewer wording changed.' }))
        expect(task.validateOutcome(stale)).toContain('repair submission')
        // A changed state earns a new correction, but already accepted cases cannot reappear.
        const sha = acceptedSha(await task.submitScenario(yamlFor([1]), [], judge))!
        expect(sha).toBeTruthy()
        const changed = task.validateOutcome(stale)!
        const rows = JSON.parse(changed.split('CURRENT REMAINING: ')[1])
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ caseId: 'case-0', reasonKind: 'assertion' })
        // Merely fixing the terminal prose cannot replace a repair submission.
        expect(task.validateOutcome({ ...stale, remaining: rows })).toContain('repair submission')
        const repaired = yamlFor([0]).replace('contains: case-0', 'matches: case-0')
        const repairedResult = await task.submitScenario(repaired, [], judge)
        const repairedSha = acceptedSha(repairedResult)!
        expect(repairedSha, repairedResult.content).toBeTruthy()
        const settled = { kind: 'settled' as const, scenarioYamlSha: repairedSha, expectedReds: [] }
        expect(task.validateOutcome(settled)).toBeUndefined()
        return { kind: 'outcome', outcome: settled }
      }) })
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios).toHaveLength(2)
    expect(entry.generationInputsHash).not.toBeNull()
    expect(entry.gaps).toEqual([])
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
    if (reason === 'review-unavailable') expect(entry.scenarios[0].reviewed).toBe(false)
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
