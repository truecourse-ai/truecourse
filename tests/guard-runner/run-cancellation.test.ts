/**
 * Run-level cancellation: `buildTimeoutMs` threading into the build, an external
 * `AbortSignal` (→ status `aborted`, phase build|run), and the overall
 * `runTimeoutMs` wall-clock (→ status `run-timed-out`, in-flight scenarios
 * killed). All timings are tiny; a prompt return is itself the proof that the
 * children were killed rather than left to their 30s step timeout.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { runGuard, guardLatestPath, isPortHeld } from '@truecourse/guard-runner'
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

const HANGING_BUILD = 'node -e "setInterval(() => {}, 1000)"'

describe('runGuard — buildTimeoutMs', () => {
  it('replaces the default build timeout: a hanging build fails fast as timed out', async () => {
    const r = repo()
    writeRecipe(r, { build: HANGING_BUILD })
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const start = Date.now()
    const res = await runGuard({ repoRoot: r, buildTimeoutMs: 200 })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res.status).toBe('build-failed')
    if (res.status === 'build-failed') expect(res.build.timedOut).toBe(true)
  })
})

describe('runGuard — external AbortSignal', () => {
  it('a pre-aborted signal returns { aborted, phase: build } without running anything', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const ac = new AbortController()
    ac.abort()
    const res = await runGuard({ repoRoot: r, signal: ac.signal })
    expect(res).toEqual({ status: 'aborted', phase: 'build' })
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
  })

  it('aborting during the build kills the build child and reports phase build', async () => {
    const r = repo()
    writeRecipe(r, { build: HANGING_BUILD })
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const ac = new AbortController()
    const start = Date.now()
    const pending = runGuard({
      repoRoot: r,
      signal: ac.signal,
      onPhase: (phase) => {
        if (phase === 'build') setTimeout(() => ac.abort(), 50)
      },
    })
    const res = await pending
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res).toEqual({ status: 'aborted', phase: 'build' })
  })

  it('aborting during a hanging install kills the install child and reports phase build', async () => {
    const r = repo()
    writeRecipe(r, { install: HANGING_BUILD })
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const ac = new AbortController()
    const start = Date.now()
    const res = await runGuard({
      repoRoot: r,
      signal: ac.signal,
      onPhase: (phase) => {
        if (phase === 'build') setTimeout(() => ac.abort(), 50)
      },
    })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res).toEqual({ status: 'aborted', phase: 'build' })
  })

  it('aborting during the run kills in-flight scenarios and reports phase run', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'hang.yaml',
      scenario({ id: 'hang', binds: specBinds('cli/boom'), steps: [{ run: ['hang'], expect: { exit: 0 } }] }),
    )

    const ac = new AbortController()
    const start = Date.now()
    const res = await runGuard({
      repoRoot: r,
      skipBuild: true,
      signal: ac.signal,
      onPhase: (phase) => {
        if (phase === 'run') setTimeout(() => ac.abort(), 100)
      },
    })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res).toEqual({ status: 'aborted', phase: 'run' })
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
  })
})

describe('runGuard — runTimeoutMs', () => {
  it('an exceeded run wall-clock aborts in-flight scenarios and reports settled/total', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'fast.yaml',
      scenario({ id: 'fast', binds: specBinds('cli/version'), steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeScenario(
      r,
      'hang.yaml',
      scenario({ id: 'hang', binds: specBinds('cli/boom'), steps: [{ run: ['hang'], expect: { exit: 0 } }] }),
    )

    const start = Date.now()
    const res = await runGuard({ repoRoot: r, skipBuild: true, concurrency: 2, runTimeoutMs: 1_000 })
    const took = Date.now() - start
    expect(took).toBeLessThan(10_000)
    expect(res.status).toBe('run-timed-out')
    if (res.status !== 'run-timed-out') return
    expect(res.total).toBe(2)
    expect(res.settled).toBe(1)
    expect(res.elapsedMs).toBeGreaterThanOrEqual(1_000)
    // A timed-out run persists nothing — no LATEST, no baseline movement.
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
  })

  it('ends at the deadline even when a scenario is parked on a promise that never settles', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/parked.yaml',
      apiScenario({
        id: 'parked',
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )
    // The preflight's boot (the first port polled) is real; every later request
    // parks forever, which is what a lost fetch looks like to its awaiter.
    const realFetch = globalThis.fetch
    const ports: number[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const port = Number(new URL(String(input)).port)
      if (!ports.includes(port)) ports.push(port)
      return port === ports[0] ? realFetch(input, init) : new Promise<Response>(() => {})
    })
    try {
      const start = Date.now()
      const res = await runGuard({ repoRoot: r, skipBuild: true, runTimeoutMs: 1_500 })
      expect(Date.now() - start).toBeLessThan(10_000)
      expect(res.status).toBe('run-timed-out')
      expect(ports.length).toBeGreaterThan(1)
      // The parked scenario's server died with the run.
      const parkedPort = ports[1]!
      await vi.waitFor(() => expect(isPortHeld(parkedPort)).toBe(false), { timeout: 5_000 })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  /** One api scenario whose one request goes to `/todos`, every other fetch real. */
  function apiRun(park: (init: RequestInit | undefined) => Promise<Response>): {
    r: string
    ports: number[]
    restore: () => void
  } {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/parked.yaml',
      apiScenario({
        id: 'parked',
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )
    const realFetch = globalThis.fetch
    const ports: number[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = new URL(String(input))
      const port = Number(url.port)
      if (!ports.includes(port)) ports.push(port)
      return url.pathname === '/todos' ? park(init) : realFetch(input, init)
    })
    return { r, ports, restore: () => fetchSpy.mockRestore() }
  }

  // The server came up healthy; the request after it never settles. The kill
  // that cancellation owes the server outlives its readiness.
  it('kills the server of a scenario parked on a request after the server was ready', async () => {
    const run = apiRun(() => new Promise<Response>(() => {}))
    try {
      const res = await runGuard({ repoRoot: run.r, skipBuild: true, runTimeoutMs: 1_500 })
      expect(res.status).toBe('run-timed-out')
      const parkedPort = run.ports.at(-1)!
      await vi.waitFor(() => expect(isPortHeld(parkedPort)).toBe(false), { timeout: 5_000 })
    } finally {
      run.restore()
    }
  })

  // A scenario that settles on the signal gets to finish its own cleanup (its
  // server stopped and gone) before the run tears down and returns.
  it('lets a cancelled scenario finish its own cleanup before the run returns', async () => {
    const run = apiRun(
      (init) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        ),
    )
    try {
      const res = await runGuard({ repoRoot: run.r, skipBuild: true, runTimeoutMs: 1_500 })
      expect(res.status).toBe('run-timed-out')
      expect(isPortHeld(run.ports.at(-1)!)).toBe(false)
    } finally {
      run.restore()
    }
  })

  it('a run-timer expiry during the build reports run-timed-out with zero settled', async () => {
    const r = repo()
    writeRecipe(r, { build: HANGING_BUILD })
    writeScenario(r, 's.yaml', scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))

    const start = Date.now()
    const res = await runGuard({ repoRoot: r, runTimeoutMs: 200 })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(res.status).toBe('run-timed-out')
    if (res.status !== 'run-timed-out') return
    expect(res.settled).toBe(0)
    expect(res.total).toBe(1)
  })
})
