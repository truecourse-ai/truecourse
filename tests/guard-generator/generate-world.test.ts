/**
 * BLAST-RADIUS SCHEDULING, the generate side (plan item 144): the batched world
 * classifier routes destructive flows into the pool's serialized mutator wave,
 * the shared world is restored after that wave, the authored `world` field
 * survives into the committed file — and the C-lite briefing hands every worker
 * the committed GREEN siblings that already walk its interfaces, so arranging
 * is copy-and-parameterize rather than rediscovery.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardSessionSummary } from '@truecourse/guard-generator'
import { looksWorldMutating } from '@truecourse/guard-generator'
import {
  FIXTURE_BIN,
  PASSING_STEPS,
  cliInterface,
  extractSessionBy,
  flowWorkerSessionOf,
  interfacesOf,
  makeTempRepo,
  raw,
  rmrf,
  runGenerate,
  scenarioYaml,
  sessionSummary,
  stampMilestones,
  submitWorkerSessions,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/tasks.md'
const TWO_FLOWS = [
  '## adding',
  '`relkit add <title>` creates a task.',
  '',
  '## deleting accounts',
  '`relkit admin delete-user` deletes a user account.',
].join('\n')

function seed(content: string): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, content)
  return r
}

describe('generateGuards — the world-mutator wave', () => {
  it('routes classifier-named flows into the serialized mutator wave', async () => {
    const r = seed(TWO_FLOWS)
    const waves = { tasks: [] as string[], mutators: [] as string[] }
    const classified: string[] = []

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add']), cliInterface(['admin', 'delete-user'])),
      extractSession: extractSessionBy({}),
      worldClassifyRunner: async (flows) => {
        // The classifier sees every changed flow and names the destructive one.
        classified.push(...flows.map((f) => f.id))
        return { mutators: flows.filter((f) => f.id.includes('delet')).map((f) => f.id) }
      },
      flowWorkerSession: async ({ tasks, epicTasks, mutatorTasks, onTask }) => {
        waves.tasks = tasks.map((t) => t.flowId)
        waves.mutators = mutatorTasks.map((t) => t.flowId)
        const all = [...tasks, ...epicTasks, ...mutatorTasks]
        const byTask = new Map()
        let done = 0
        onTask?.(0, all.length)
        for (const t of all) {
          byTask.set(t.workItem, {
            kind: 'outcome',
            outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'x' }] },
          })
          onTask?.(++done, all.length, 'blocked')
        }
        return { byTask, summary: sessionSummary('guard-generate.flow-worker', { ran: all.length }) }
      },
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(classified.sort()).toHaveLength(2)
    expect(waves.tasks).toHaveLength(1)
    expect(waves.mutators).toHaveLength(1)
    expect(waves.mutators[0]).toMatch(/delet/)
  }, 60_000)

  it('an authored `world: mutates` declaration survives into the committed file', async () => {
    // A reset-declaring recipe: the deterministic gate bars mutates drafts
    // without one. The submit stub's first attempt is deferred (it drafts the
    // mutator mid-wave); the tail-only re-dispatch settles it.
    const r = repo()
    writeRecipe(r, { api: { serve: ['node', 'server.mjs'], services: { up: 'true', down: 'true', reset: 'true' } } })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## adding', '`relkit add <title>` creates a task.'].join('\n'))

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add'])),
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() =>
        raw('Adding works', PASSING_STEPS, { world: 'mutates' }),
      ),
    })

    expect(res.errors).toEqual([])
    expect(res.written).toHaveLength(1)
    const committed = fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')
    expect(committed).toMatch(/^world: mutates$/m)
  }, 60_000)

  it('briefs a worker with the committed GREEN siblings that share its interfaces', async () => {
    const r = seed(['## adding', '`relkit add <title>` creates a task.'].join('\n'))
    // Run 1: settle a green scenario on the `add` interface.
    const first = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add'])),
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => raw('Adding works', PASSING_STEPS)),
    })
    expect(first.errors).toEqual([])
    expect(first.written).toHaveLength(1)

    // Run 2: a NEW flow on the same interface — its briefing carries run 1's
    // green scenario as a proven sibling.
    writeDoc(r, DOC, [
      '## adding',
      '`relkit add <title>` creates a task.',
      '',
      '## adding again',
      '`relkit add` also accepts a second task.',
    ].join('\n'))
    const briefings: string[] = []
    const second = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add'])),
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        briefings.push(await task.prepare())
        return {
          kind: 'outcome',
          outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'x' }] },
        }
      }),
    })
    expect(second.status).toBe('ok')

    const fresh = briefings.filter((b) => b.includes('SETTLED SIBLING SCENARIOS'))
    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh[0]).toContain(`--- sibling ${first.written[0].id}`)
    // The sibling rides as full YAML — the arrange verbs are the point.
    expect(fresh[0]).toContain('run:')
  }, 60_000)
})

// A section whose default claim carries a mutation keyword ("passwords claim"),
// beside a plainly additive one — what the fail-closed keyword fallback keys on.
const ADDITIVE_AND_PASSWORD = [
  '## adding',
  '`relkit add <title>` creates a task.',
  '',
  '## changing the password',
  '`relkit admin set-password` rewrites the stored password.',
].join('\n')

describe('generateGuards — classifier loss fails closed', () => {
  it('retries a lost classify chunk before falling back', async () => {
    const r = seed(TWO_FLOWS)
    let calls = 0
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add']), cliInterface(['admin', 'delete-user'])),
      extractSession: extractSessionBy({}),
      worldClassifyRunner: async () => {
        calls++
        if (calls === 1) throw new Error('transient timeout')
        return { mutators: [] }
      },
      flowWorkerSession: flowWorkerSessionOf(async () => ({
        kind: 'outcome',
        outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'x' }] },
      })),
    })
    expect(calls).toBe(2)
    expect(res.errors).toEqual([])
  }, 60_000)

  it('a chunk lost twice schedules keyword suspects into the mutator tail', async () => {
    const r = seed(ADDITIVE_AND_PASSWORD)
    const waves = { tasks: [] as string[], mutators: [] as string[] }
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add']), cliInterface(['admin', 'set-password'])),
      extractSession: extractSessionBy({}),
      worldClassifyRunner: async () => {
        throw new Error('claude timed out after 300000ms')
      },
      flowWorkerSession: async ({ tasks, mutatorTasks, onTask }) => {
        waves.tasks.push(...tasks.map((t) => t.flowId))
        waves.mutators.push(...mutatorTasks.map((t) => t.flowId))
        const all = [...tasks, ...mutatorTasks]
        const byTask = new Map()
        onTask?.(0, all.length)
        for (const t of all) {
          byTask.set(t.workItem, {
            kind: 'outcome',
            outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'x' }] },
          })
        }
        return { byTask, summary: sessionSummary('guard-generate.flow-worker', { ran: all.length }) }
      },
    })
    expect(res.status).toBe('ok')
    expect(waves.mutators).toHaveLength(1)
    expect(waves.mutators[0]).toMatch(/password/)
    expect(waves.tasks).toHaveLength(1)
    expect(waves.tasks[0]).toMatch(/adding/)
    const fallback = res.errors.filter((e) => /deterministic fallback scheduled 1 suspect/.test(e.message))
    expect(fallback).toHaveLength(1)
  }, 60_000)

  it('looksWorldMutating flags credential phrases and passes additive flows', () => {
    expect(looksWorldMutating({ title: 'sessions', milestones: ['revoke every other session'] })).toBe(true)
    expect(looksWorldMutating({ title: 'change the password', milestones: [] })).toBe(true)
    expect(looksWorldMutating({ title: 'adding', milestones: ['creating a task returns its id'] })).toBe(false)
  })
})

describe('generateGuards — the deterministic mutator gate', () => {
  it('refuses a mutates draft outright when the recipe declares no reset', async () => {
    const r = seed(['## adding', '`relkit add <title>` creates a task.'].join('\n'))
    const refusals: string[] = []
    let invocations = 0
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add'])),
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        invocations++
        const yaml = scenarioYaml(stampMilestones(raw('Adding works', PASSING_STEPS, { world: 'mutates' }), task.milestoneCount))
        const report = await task.runScenario(yaml)
        expect(report.isError).toBe(true)
        refusals.push(report.content)
        return {
          kind: 'outcome',
          outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'a recipe api.services.reset command' }] },
        }
      }),
    })
    expect(res.status).toBe('ok')
    expect(invocations).toBe(1) // no re-dispatch: without a reset the tail cannot repair either
    expect(refusals[0]).toMatch(/api\.services\.reset/)
    expect(refusals[0]).toMatch(/refuses to run a mutation it cannot repair/)
  }, 60_000)

  it('defers a mid-wave mutates draft and re-runs the flow in a tail-only invocation', async () => {
    const r = repo()
    writeRecipe(r, { api: { serve: ['node', 'server.mjs'], services: { up: 'true', down: 'true', reset: 'true' } } })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## adding', '`relkit add <title>` creates a task.'].join('\n'))

    const invocationWaves: { tasks: string[]; mutators: string[] }[] = []
    const refusals: string[] = []
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add'])),
      extractSession: extractSessionBy({}),
      flowWorkerSession: async ({ tasks, epicTasks, mutatorTasks, onTask }) => {
        invocationWaves.push({ tasks: tasks.map((t) => t.flowId), mutators: mutatorTasks.map((t) => t.flowId) })
        const byTask = new Map()
        const all = [...tasks, ...epicTasks, ...mutatorTasks]
        onTask?.(0, all.length)
        for (const task of all) {
          const yaml = scenarioYaml(stampMilestones(raw('Adding works', PASSING_STEPS, { world: 'mutates' }), task.milestoneCount))
          if (invocationWaves.length === 1) {
            // Wave session: the gate must refuse the execution and defer.
            const report = await task.runScenario(yaml)
            expect(report.isError).toBe(true)
            refusals.push(report.content)
            byTask.set(task.workItem, {
              kind: 'outcome',
              outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'deferred to the serialized mutator wave' }] },
            })
          } else {
            // Tail-only re-dispatch: the same draft now executes and settles.
            const report = await task.submitScenario(yaml, [], async () => ({ kind: 'faithful' }))
            const sha = /under sha ([0-9a-f]{64})/.exec(report.content)?.[1]
            expect(sha).toBeTruthy()
            byTask.set(task.workItem, {
              kind: 'outcome',
              outcome: { kind: 'settled', scenarioYamlSha: sha!, expectedReds: [] },
            })
          }
        }
        return { byTask, summary: sessionSummary('guard-generate.flow-worker', { ran: all.length }) }
      },
    })

    expect(res.errors).toEqual([])
    expect(invocationWaves).toHaveLength(2)
    expect(invocationWaves[0].tasks).toHaveLength(1)
    expect(invocationWaves[0].mutators).toHaveLength(0)
    expect(invocationWaves[1].tasks).toHaveLength(0)
    expect(invocationWaves[1].mutators).toHaveLength(1)
    expect(refusals[0]).toMatch(/serialized final wave/)
    expect(res.written).toHaveLength(1)
    const committed = fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')
    expect(committed).toMatch(/^world: mutates$/m)
    // The tail executed and the declared reset ran — the dirty marker is gone.
    expect(fs.existsSync(path.join(r, '.truecourse', 'guard', '.world-dirty'))).toBe(false)
  }, 60_000)

  it('skips the re-dispatch when the session settles with a rewrite that does not mutate', async () => {
    const r = repo()
    writeRecipe(r, { api: { serve: ['node', 'server.mjs'], services: { up: 'true', down: 'true', reset: 'true' } } })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## adding', '`relkit add <title>` creates a task.'].join('\n'))

    let invocations = 0
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['add'])),
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        invocations++
        const mutYaml = scenarioYaml(stampMilestones(raw('Adding works', PASSING_STEPS, { world: 'mutates' }), task.milestoneCount))
        const refused = await task.runScenario(mutYaml)
        expect(refused.isError).toBe(true)
        // The worker takes the refusal's advice: rewrite without the mutation.
        const safeYaml = scenarioYaml(stampMilestones(raw('Adding works', PASSING_STEPS), task.milestoneCount))
        const report = await task.submitScenario(safeYaml, [], async () => ({ kind: 'faithful' }))
        const sha = /under sha ([0-9a-f]{64})/.exec(report.content)?.[1]
        expect(sha).toBeTruthy()
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha!, expectedReds: [] } }
      }),
    })
    expect(res.errors).toEqual([])
    expect(invocations).toBe(1)
    expect(res.written).toHaveLength(1)
  }, 60_000)
})
