/**
 * The cli driver's MANAGED-SERVICE steps: `boot` (readiness on a stdout/stderr
 * line), `signal`, `logs` — the cli convergence onto the api driver's process
 * lifecycle, on process semantics. Every case runs the real relkit fixture's
 * long-running `serve` monitor through `runGuard`, so the semantics (readiness,
 * replacement, signals, log windows, end-of-scenario reaping) are exercised
 * against a real child, not a stub of one.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, runScenario } from '@truecourse/guard-runner'
import type { GuardScenarioResult } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** Run one cli scenario and return its result row. */
async function runOne(
  r: string,
  steps: unknown[],
  opts: { id?: string; setup?: { env?: Record<string, string> } } = {},
): Promise<GuardScenarioResult> {
  const id = opts.id ?? 'service'
  writeScenario(
    r,
    `cli/${id}.yaml`,
    scenario({
      id,
      binds: specBinds('a/b'),
      ...(opts.setup ? { setup: opts.setup } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      steps: steps as any,
    }),
  )
  const res = await runGuard({ repoRoot: r, skipBuild: true })
  expect(res.status).toBe('ok')
  if (res.status !== 'ok') throw new Error('run failed')
  return res.latest.scenarios.find((s) => s.id === id)!
}

const BOOT = { boot: { run: ['serve'], ready: { stream: 'stdout', match: 'relkit monitor listening' } } }

/** True when the pid is gone (ESRCH); signal 0 probes without delivering. */
function processDead(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

describe('cli driver — boot steps', () => {
  it('boots the service on its readiness line; sibling run steps execute against it', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      BOOT,
      // The monitor is up: its state file answers the health-check command.
      { run: ['status'], expect: { exit: 0, stdout: { contains: 'monitor is running' } } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('matches readiness by regex too', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      { boot: { run: ['serve'], ready: { stream: 'stdout', match: { pattern: 'listening \\(pid \\d+\\)' } } } },
      { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('FAILS (not errors) when the readiness line never appears within its budget', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      {
        boot: {
          run: ['serve'],
          env: { RELKIT_SERVE_SILENT: '1' },
          ready: { stream: 'stdout', match: 'relkit monitor listening', withinMs: 800 },
        },
      },
    ])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.expected).toContain('relkit monitor listening')
    expect(row.failure!.expected).toContain('within 800ms')
  })

  it('FAILS when the service exits before becoming ready, quoting how it went down', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      {
        boot: {
          run: ['serve'],
          env: { RELKIT_SERVE_FAIL: '1' },
          ready: { stream: 'stdout', match: 'relkit monitor listening' },
        },
      },
    ])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.actual).toContain('exited with code 4')
    expect(row.failure!.actual).toContain('before the readiness line appeared')
  })

  it('ERRORS (never fails) when the entry cannot be spawned at all', async () => {
    const r = repo()
    const row = await runScenario(
      scenario({
        id: 'spawn-fail',
        binds: specBinds('a/b'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        steps: [BOOT] as any,
      }),
      {
        repoRoot: r,
        runId: 'run-1',
        resolvedEntry: ['/definitely/not/an/executable'],
        unique: 'u',
        stepTimeoutMs: 5_000,
        capturePassEvidence: false,
      },
    )
    expect(row.outcome).toBe('error')
    expect(row.failure!.actual).toContain('failed to spawn')
  })

  it('a second boot replaces the first — both banners readable, both processes reaped', async () => {
    const r = repo()
    writeRecipe(r)
    const pidA = path.join(r, 'monitor-a.pid')
    const pidB = path.join(r, 'monitor-b.pid')
    const row = await runOne(r, [
      { boot: { run: ['serve'], env: { RELKIT_SERVE_PIDFILE: pidA }, ready: { stream: 'stdout', match: 'listening' } } },
      { boot: { run: ['serve'], env: { RELKIT_SERVE_PIDFILE: pidB }, ready: { stream: 'stdout', match: 'listening' } } },
      // The accumulator spans boots: the replaced service's banner is still readable.
      { logs: { stream: 'stdout', match: 'relkit monitor listening', count: 2 } },
    ])
    expect(row.outcome).toBe('pass')
    expect(processDead(Number(fs.readFileSync(pidA, 'utf-8')))).toBe(true)
    expect(processDead(Number(fs.readFileSync(pidB, 'utf-8')))).toBe(true)
  })
})

describe('cli driver — signal steps', () => {
  it('SIGTERM shuts the service down with exit code 0 within its budget', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      BOOT,
      { signal: { name: 'SIGTERM', expect: { exitCode: 0, withinMs: 5_000 } } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('SIGINT shuts the service down with exit code 0', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [BOOT, { signal: { name: 'SIGINT', expect: { exitCode: 0 } } }])
    expect(row.outcome).toBe('pass')
  })

  it('FAILS on the wrong shutdown exit code', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(
      r,
      [BOOT, { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } }],
      { setup: { env: { RELKIT_SERVE_EXIT: '7' } } },
    )
    expect(row.outcome).toBe('fail')
    expect(row.failure!.actual).toContain('exited with code 7')
  })

  it('FAILS when the service ignores the signal past `withinMs`', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(
      r,
      [BOOT, { signal: { name: 'SIGTERM', expect: { exitCode: 0, withinMs: 800 } } }],
      { setup: { env: { RELKIT_SERVE_IGNORE_SIGNALS: '1' } } },
    )
    expect(row.outcome).toBe('fail')
    expect(row.failure!.actual).toContain('still running')
  })

  it('ERRORS when nothing is running to signal', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [{ signal: { name: 'SIGTERM' } }])
    expect(row.outcome).toBe('error')
    expect(row.failure!.actual).toContain('no service is running')
  })
})

describe('cli driver — logs steps', () => {
  it('ERRORS when no boot preceded the logs step', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [{ logs: { stream: 'stdout', match: 'anything' } }])
    expect(row.outcome).toBe('error')
    expect(row.failure!.actual).toContain('no service has been started yet')
  })

  it('`sinceLastStep` attributes a line to the run step that caused it, and to no later window', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      BOOT,
      // The note command drops the marker file the monitor answers with a log line.
      { run: ['note', 'monitor.request', 'go'], expect: { exit: 0 } },
      // The line the note step caused is in the window that opened at that step…
      { logs: { stream: 'stdout', match: 'handled request #1', sinceLastStep: true, count: 1 } },
      // …and output settled before a step began never reaches a later window: the
      // banner predates the note step, so this window excludes it.
      { logs: { stream: 'stdout', match: 'relkit monitor listening', sinceLastStep: true, count: 0 } },
    ])
    expect(row.outcome).toBe('pass')
  })

  it('FAILS when no line matches, quoting the window', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      BOOT,
      { logs: { stream: 'stdout', match: 'a line the monitor never writes', withinMs: 300 } },
    ])
    expect(row.outcome).toBe('fail')
    expect(row.failure!.expected).toContain('a line the monitor never writes')
    expect(row.failure!.actual).toContain('0 line(s) matched')
  })

  it('a service that already exited still leaves its output readable', async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      BOOT,
      { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
      { logs: { stream: 'stdout', match: 'monitor stopped (SIGTERM)' } },
    ])
    expect(row.outcome).toBe('pass')
  })
})

describe('cli driver — end-of-scenario reaping + evidence', () => {
  it('kills the service when a later step FAILS — the scenario never leaks it', async () => {
    const r = repo()
    writeRecipe(r)
    const pidfile = path.join(r, 'monitor.pid')
    const row = await runOne(r, [
      { boot: { run: ['serve'], env: { RELKIT_SERVE_PIDFILE: pidfile }, ready: { stream: 'stdout', match: 'listening' } } },
      // boom exits 7; expecting 0 fails the scenario mid-flight.
      { run: ['boom'], expect: { exit: 0 } },
    ])
    expect(row.outcome).toBe('fail')
    expect(processDead(Number(fs.readFileSync(pidfile, 'utf-8')))).toBe(true)
  })

  it("records lifecycle steps in the bundle, with the service's captured output", async () => {
    const r = repo()
    writeRecipe(r)
    const row = await runOne(r, [
      BOOT,
      { run: ['status'], expect: { exit: 0 } },
      { logs: { stream: 'stdout', match: 'listening' } },
      { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
    ])
    expect(row.outcome).toBe('pass')
    const dir = path.join(r, row.evidencePath!)
    const invocation = JSON.parse(fs.readFileSync(path.join(dir, 'invocation.json'), 'utf-8'))
    expect(invocation.steps[0]).toMatchObject({ kind: 'boot', action: 'start the service: serve' })
    expect(invocation.steps[2]).toMatchObject({ kind: 'logs' })
    expect(invocation.steps[3]).toMatchObject({ kind: 'signal', expectation: 'exits 0' })
    const transcript = fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('signal:  signal SIGTERM')
    const stdout = fs.readFileSync(path.join(dir, 'service.stdout.txt'), 'utf-8')
    expect(stdout).toContain('relkit monitor listening')
    expect(stdout).toContain('monitor stopped (SIGTERM)')
  })
})

describe('cli driver — the daemon field case, as authored YAML', () => {
  it('start → health-check → tail logs → graceful stop is expressible and green', async () => {
    // The `start-monitor-and-stop-the-truecourse-dashboard` shape: a scenario a
    // model would author for a long-running console service, written by hand as
    // the YAML that lands in `.truecourse/scenarios/` and driven through the real
    // runner.
    const r = repo()
    writeRecipe(r)
    const bind = specBinds('a/b')[0]
    const yaml = [
      'guard: 2',
      'id: start-monitor-and-stop.cli.1',
      'title: The monitor starts, answers a health check, logs its work, and stops cleanly',
      'binds:',
      `  - doc: ${bind.doc}`,
      `    section: ${bind.section}`,
      `    fingerprint: ${bind.fingerprint}`,
      'driver: cli',
      'steps:',
      '  - boot:',
      '      run: ["serve"]',
      '      ready:',
      '        stream: stdout',
      '        match: "relkit monitor listening"',
      '    milestone: 1',
      '  - run: ["status"]',
      '    expect:',
      '      exit: 0',
      '      stdout:',
      '        contains: "monitor is running"',
      '    milestone: 2',
      '  - run: ["note", "monitor.request", "go"]',
      '    expect:',
      '      exit: 0',
      '  - logs:',
      '      stream: stdout',
      '      match: "handled request #1"',
      '      sinceLastStep: true',
      '      count: 1',
      '    milestone: 3',
      '  - signal:',
      '      name: SIGTERM',
      '      expect:',
      '        exitCode: 0',
      '        withinMs: 5000',
      '    milestone: 4',
      '  - run: ["status"]',
      '    expect:',
      '      exit: 3',
      '      stderr:',
      '        contains: "monitor is not running"',
      '    milestone: 4',
      'normalize: []',
      '',
    ].join('\n')
    const target = path.join(r, '.truecourse', 'scenarios', 'cli', 'field-case.yaml')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, yaml)

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') throw new Error('run failed')
    const row = res.latest.scenarios.find((s) => s.id === 'start-monitor-and-stop.cli.1')!
    expect(row.outcome).toBe('pass')
    // The evidence carries the whole service transcript: boot, the handled
    // request, the graceful stop.
    const stdout = fs.readFileSync(path.join(r, row.evidencePath!, 'service.stdout.txt'), 'utf-8')
    expect(stdout).toContain('relkit monitor listening')
    expect(stdout).toContain('handled request #1')
    expect(stdout).toContain('monitor stopped (SIGTERM)')
  })
})
