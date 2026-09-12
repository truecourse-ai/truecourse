import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { scenarioReviewFingerprint } from '@truecourse/shared/guard-proof-node'
import { GUARD_REVIEW_POLICY_VERSION, type GuardScenario } from '@truecourse/shared'
import type { GuardExecutor } from '@truecourse/guard-runner'
import {
  makeTempRepo, rmrf, writeApiRecipe, writeCorpus, writeDoc, extractSessionBy,
  interfacesOf, apiInterface, rawApi, PASSING_API_STEPS, runGenerate,
  scenarioYaml, stampMilestones, sessionSummary,
} from './helpers.js'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })

function seed() {
  const r = makeTempRepo()
  repos.push(r)
  writeApiRecipe(r, { entry: null })
  const file = path.join(r, '.truecourse/scenarios/recipe.json')
  const recipe = JSON.parse(fs.readFileSync(file, 'utf8'))
  recipe.api.services = { up: 'true', down: 'true', reset: 'true' }
  recipe.preparations = { private: {
    baseline: 'seeded', scope: 'instance', needs: [], env: {},
    postgres: { isolation: 'database', urlEnvs: ['DATABASE_URL'] },
    baselineChecks: [{ path: '/todos', counts: { 'todos.length': 0 } }],
    seed: { script: 'seed.mjs', provides: { fixtures: {}, credentials: {} } },
    verify: { script: 'verify.mjs' }, cleanup: { script: 'cleanup.mjs' },
  } }
  fs.writeFileSync(file, JSON.stringify(recipe))
  writeCorpus(r, [{ ref: 'docs/api.md' }])
  writeDoc(r, 'docs/api.md', '## list\nGET /todos returns 200 with the todo list.')
  return r
}

const extraction = () => extractSessionBy({
  list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status + body' }],
})

describe('prepared mutator execution boundary', () => {
  it('gates trials, changed submissions and cached confirmations, then retries shared work serially', async () => {
    const r = seed()
    let executions = 0
    let invocations = 0
    let executedScenario: GuardScenario | undefined
    const executor: GuardExecutor = async input => {
      executions++
      executedScenario = input.scenarios[0]
      return { status: 'ok', latest: { scenarios: input.scenarios.map(s => ({
        id: s.id, title: s.title, binds: s.binds[0], outcome: 'pass', durationMs: 10,
      })) } } as never
    }
    const result = await runGenerate({
      repoRoot: r, executor, extractSession: extraction(),
      interfaces: interfacesOf(r, apiInterface('GET', '/todos')),
      worldClassifyRunner: async flows => ({ mutators: flows.map(f => f.id) }),
      flowWorkerSession: async ({ tasks, epicTasks, preparedMutatorTasks = [], mutatorTasks }) => {
        invocations++
        expect(tasks).toHaveLength(0)
        expect(epicTasks).toHaveLength(0)
        expect(preparedMutatorTasks).toHaveLength(invocations === 1 ? 1 : 0)
        expect(mutatorTasks).toHaveLength(invocations === 1 ? 0 : 1)
        const task = [...preparedMutatorTasks, ...mutatorTasks][0]!
        const draft = (prepared: boolean) => scenarioYaml(stampMilestones(rawApi('List todos', PASSING_API_STEPS,
          prepared ? { setup: { preparation: 'private' }, world: 'mutates' } : {}), task.milestoneCount))
        const byTask = new Map()
        if (invocations === 1) {
          expect(await task.prepare()).toContain('PRIVATE AUTHORING')
          expect((await task.runScenario(draft(false))).content).toContain('private authoring')
          expect(executions).toBe(0)
          expect((await task.runScenario(draft(true))).isError).not.toBe(true)
          expect(executions).toBe(1)
          expect((await task.submitScenario(draft(false), [], async () => ({ kind: 'faithful' }))).content).toContain('private authoring')
          expect(executions).toBe(1)
          // A previously accepted shared-state scenario has a valid review and
          // unchanged cache identity. It must still obey the current pool gate.
          const scenario = structuredClone(executedScenario!)
          const cached = (s: GuardScenario) => [{ yaml: yaml.dump(s), expectedReds: [], review: {
            policyVersion: GUARD_REVIEW_POLICY_VERSION,
            scenarioFingerprint: scenarioReviewFingerprint(s), caseEvidence: [],
          } }]
          expect(await task.confirmCached(cached(scenario))).toBe(true)
          expect(executions).toBe(2)
          delete scenario.setup
          const confirmed = await task.confirmCached(cached(scenario))
          expect(confirmed).toBe(false)
          expect(executions).toBe(2)
          byTask.set(task.workItem, { kind: 'outcome', outcome: { kind: 'blocked',
            perMilestone: [{ order: 1, capability: 'deferred to the serialized mutator wave' }] } })
        } else {
          expect(await task.prepare()).not.toContain('PRIVATE AUTHORING')
          expect((await task.runScenario(draft(false))).isError).not.toBe(true)
          expect(executions).toBe(3)
          byTask.set(task.workItem, { kind: 'outcome', outcome: { kind: 'blocked',
            perMilestone: [{ order: 1, capability: 'test ends after proving execution' }] } })
        }
        return { byTask, summary: sessionSummary('guard-generate.flow-worker', { ran: 1 }) }
      },
    })
    expect(result.status).toBe('ok')
    expect(invocations).toBe(2)
  }, 60_000)

  it('honors an explicit shared-state deferral before the author attempts execution', async () => {
    const r = seed()
    let invocations = 0
    await runGenerate({
      repoRoot: r, extractSession: extraction(),
      interfaces: interfacesOf(r, apiInterface('GET', '/todos')),
      worldClassifyRunner: async flows => ({ mutators: flows.map(f => f.id) }),
      flowWorkerSession: async ({ preparedMutatorTasks = [], mutatorTasks }) => {
        invocations++
        expect(preparedMutatorTasks.length).toBe(invocations === 1 ? 1 : 0)
        expect(mutatorTasks.length).toBe(invocations === 1 ? 0 : 1)
        const task = [...preparedMutatorTasks, ...mutatorTasks][0]!
        return { byTask: new Map([[task.workItem, { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: [{
          order: 1, capability: invocations === 1 ? 'deferred to the serialized mutator wave' : 'missing external account',
        }] } }]]), summary: sessionSummary('guard-generate.flow-worker', { ran: 1 }) }
      },
    })
    expect(invocations).toBe(2)
  }, 60_000)
})
