/**
 * The blocked-precondition ANNOTATION.
 *
 * A scenario whose UNMILESTONED step fails (the seeding request at the head of a
 * flow, the login) is red for a reason that is not doc-vs-code drift: the
 * specified behavior was never reached. The annotation says so on BOTH drivers;
 * the outcome enum is untouched (it is still a `fail`) — an annotation by design,
 * on the `journeyDrifted` precedent. It is deliberately silent on a scenario that
 * declares no milestone at all — a hand-written test asserts THROUGH its plumbing,
 * so an unmilestoned failure there IS its verdict.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import { runGuard } from '@truecourse/guard-runner'
import { GuardLatestSchema } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeScenario,
  scenario,
  apiScenario,
  specBinds,
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

const FLOW = { id: 'publish-a-release', fingerprint: 'sha256:flow-fp' }

describe('blocked-precondition annotation — cli driver', () => {
  it('annotates an unmilestoned setup failure, and nothing else', async () => {
    const r = repo()
    writeRecipe(r)
    // The SETUP step (no milestone) fails before milestone 1 ever runs.
    writeScenario(
      r,
      'flow/setup-broke.yaml',
      scenario({
        id: 'publish-a-release.cli.1',
        flow: FLOW,
        binds: specBinds('cli/boom'),
        steps: [
          { run: ['boom'], expect: { exit: 0 } },
          { run: ['--version'], expect: { exit: 0 }, milestone: 1 },
        ],
      }),
    )
    // The MILESTONED step fails — ordinary drift, no annotation.
    writeScenario(
      r,
      'flow/drifted.yaml',
      scenario({
        id: 'publish-a-release.cli.2',
        flow: FLOW,
        binds: specBinds('cli/version'),
        steps: [
          { run: ['--version'], expect: { exit: 0 } },
          { run: ['boom'], expect: { exit: 0 }, milestone: 1 },
        ],
      }),
    )
    // Passing scenario — an annotation is a failure-only fact.
    writeScenario(
      r,
      'flow/green.yaml',
      scenario({
        id: 'publish-a-release.cli.3',
        flow: FLOW,
        binds: specBinds('cli/whoami'),
        steps: [
          { run: ['--version'], expect: { exit: 0 } },
          { run: ['whoami'], expect: { exit: 0 }, milestone: 1 },
        ],
      }),
    )
    // Hand-written: NO milestone anywhere, so its unmilestoned failure is its verdict.
    writeScenario(
      r,
      'manual.yaml',
      scenario({ id: 'manual', binds: specBinds('a/b'), steps: [{ run: ['boom'], expect: { exit: 0 } }] }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const by = new Map(res.latest.scenarios.map((s) => [s.id, s]))

    const blocked = by.get('publish-a-release.cli.1')!
    expect(blocked.outcome).toBe('fail')
    expect(blocked.blockedPrecondition).toBe(true)
    // The annotation never becomes an outcome and never invents a milestone.
    expect(blocked.failedMilestone).toBeUndefined()

    const drifted = by.get('publish-a-release.cli.2')!
    expect(drifted.outcome).toBe('fail')
    expect(drifted.failedMilestone).toBe(1)
    expect(drifted.blockedPrecondition).toBeUndefined()

    expect(by.get('publish-a-release.cli.3')!.outcome).toBe('pass')
    expect(by.get('publish-a-release.cli.3')!.blockedPrecondition).toBeUndefined()

    const manual = by.get('manual')!
    expect(manual.outcome).toBe('fail')
    expect(manual.blockedPrecondition).toBeUndefined()

    // It survives persistence — LATEST parses it back through the shared schema.
    const latest = GuardLatestSchema.parse(JSON.parse(fs.readFileSync(res.latestPath, 'utf-8')))
    expect(latest.scenarios.find((s) => s.id === 'publish-a-release.cli.1')).toMatchObject({
      outcome: 'fail',
      blockedPrecondition: true,
    })
  })
})

describe('blocked-precondition annotation — api driver', () => {
  it('annotates a failing seeding request, not a failing assertion', async () => {
    const r = repo()
    writeApiRecipe(r)

    // Step 1 SEEDS (no milestone) and 404s — the flow never reaches its claim.
    writeScenario(
      r,
      'api/seed-broke.yaml',
      apiScenario({
        id: 'todo-lifecycle.api.1',
        flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
        binds: specBinds('a/b'),
        steps: [
          { request: { method: 'POST', path: '/todos/999/reopen' }, expect: { status: 200 } },
          { request: { method: 'GET', path: '/todos' }, expect: { status: 200 }, milestone: 1 },
        ],
      }),
    )
    // The milestoned assertion is what fails — real drift, no annotation.
    writeScenario(
      r,
      'api/claim-broke.yaml',
      apiScenario({
        id: 'todo-lifecycle.api.2',
        flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
        binds: specBinds('cli/version'),
        steps: [
          { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
          { request: { method: 'GET', path: '/todos/999' }, expect: { status: 200 }, milestone: 1 },
        ],
      }),
    )
    // Green — nothing to annotate.
    writeScenario(
      r,
      'api/green.yaml',
      apiScenario({
        id: 'todo-lifecycle.api.3',
        flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
        binds: specBinds('cli/whoami'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 }, milestone: 1 }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const by = new Map(res.latest.scenarios.map((s) => [s.id, s]))

    const blocked = by.get('todo-lifecycle.api.1')!
    expect(blocked.outcome).toBe('fail')
    expect(blocked.failure?.step).toBe(1)
    expect(blocked.blockedPrecondition).toBe(true)
    expect(blocked.failedMilestone).toBeUndefined()

    const drifted = by.get('todo-lifecycle.api.2')!
    expect(drifted.outcome).toBe('fail')
    expect(drifted.failedMilestone).toBe(1)
    expect(drifted.blockedPrecondition).toBeUndefined()

    const green = by.get('todo-lifecycle.api.3')!
    expect(green.outcome).toBe('pass')
    expect(green.blockedPrecondition).toBeUndefined()
  })
})
