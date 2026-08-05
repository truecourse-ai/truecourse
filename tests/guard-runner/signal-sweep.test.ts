import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXTURE_API_SERVER } from './helpers.js'

/**
 * Guard children (steps, builds, api servers) lead their OWN process group, so they
 * are not in the terminal's foreground group and the timers that would reap them
 * live in the CLI process. Ctrl-C, `kill`, a closed terminal or a plain
 * `process.exit()` must therefore take whatever is running down with the CLI.
 *
 * Signal disposition is per-process, so these run a real driver process and kill it
 * mid-run.
 */

/** The built entry the drivers import — the same module the tests exercise. */
const GUARD_RUNNER_DIST = fileURLToPath(
  new URL('../../packages/guard-runner/dist/index.js', import.meta.url),
)

/**
 * Runs a step that spawns a long-lived grandchild on inherited stdio. `wait` keeps
 * the step's own command running until the test signals it; `exit` calls
 * `process.exit(0)` on its own once the step is up, which exercises the sweep's
 * `'exit'` path; `daemon` lets the command RETURN, leaving only the grandchild
 * holding the pipes — the shape a real `relkit watch` step has.
 */
const STEP_DRIVER = `
import fs from 'node:fs'
import { executeStep } from ${JSON.stringify(GUARD_RUNNER_DIST)}

const [pidFile, mode] = process.argv.slice(2)

const step = [
  "const fs = require('fs')",
  "const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'inherit' })",
  'g.unref()',
  "fs.writeFileSync(process.env.TC_PID_FILE, JSON.stringify({ child: process.pid, grandchild: g.pid }))",
  ...(mode === 'daemon' ? [] : ['setTimeout(() => {}, 600000)']),
].join(';')

if (mode === 'exit') {
  const poll = setInterval(() => {
    if (!fs.existsSync(pidFile)) return
    clearInterval(poll)
    process.exit(0)
  }, 20)
}

await executeStep({
  argv: [process.execPath, '-e', step],
  cwd: process.cwd(),
  env: { ...process.env, TC_PID_FILE: pidFile },
  timeoutMs: 600_000,
})
`

/**
 * Boots the fixture api through the normal `startApiServer` seam. The handle
 * exposes no pid, so the serve argv records the server's own before loading the
 * fixture in-process. `stop` shuts the server down the ordinary way and exits.
 */
const API_DRIVER = `
import fs from 'node:fs'
import { startApiServer } from ${JSON.stringify(GUARD_RUNNER_DIST)}

const [pidFile, readyFile, mode] = process.argv.slice(2)

const boot = [
  "require('fs').writeFileSync(process.env.TC_PID_FILE, JSON.stringify({ server: process.pid }))",
  'import(process.env.TC_SERVER)',
].join(';')

const result = await startApiServer({
  resolvedServe: [process.execPath, '-e', boot],
  cwd: process.cwd(),
  env: {
    ...process.env,
    TC_PID_FILE: pidFile,
    TC_SERVER: ${JSON.stringify(FIXTURE_API_SERVER)},
  },
  healthPath: '/health',
  readyTimeoutMs: 30_000,
})

if (!result.ok) {
  process.stderr.write('boot failed: ' + result.reason + result.stderr)
  process.exit(1)
}
fs.writeFileSync(readyFile, result.server.baseUrl)

if (mode === 'stop') {
  await result.server.stop()
  process.exit(0)
}
`

let cwd: string
/** Pids the driver reported, force-killed on teardown so a regression can't leak. */
let recorded: number[] = []

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sweep-'))
  recorded = []
})
afterEach(() => {
  for (const pid of recorded) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(cwd, { recursive: true, force: true })
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 200 && alive(pid); i++) await sleep(25)
  return !alive(pid)
}

interface DriverRun<Pids> {
  pids: Pids
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  kill(signal: NodeJS.Signals): void
}

/** Start a driver, wait for `ready`, and return the pids it reported. */
async function startDriver<Pids extends Record<string, number>>(
  source: string,
  args: string[],
  ready: () => boolean,
): Promise<DriverRun<Pids>> {
  const driverPath = path.join(cwd, 'driver.mjs')
  fs.writeFileSync(driverPath, source)
  const pidFile = path.join(cwd, 'pids.json')

  const driver = spawn(process.execPath, [driverPath, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  driver.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf-8')))

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    driver.on('exit', (code, signal) => resolve({ code, signal }))
  })

  for (let i = 0; i < 400 && !ready(); i++) await sleep(25)
  // The file exists from the moment it is CREATED, so a reader can arrive between
  // the create and the write and see nothing. Read until it parses, not until it
  // exists.
  const readPids = (): Pids | undefined => {
    try {
      const raw = fs.readFileSync(pidFile, 'utf-8')
      return raw.length > 0 ? (JSON.parse(raw) as Pids) : undefined
    } catch {
      return undefined
    }
  }
  let pids: Pids | undefined
  for (let i = 0; i < 200 && pids === undefined; i++) {
    pids = readPids()
    if (pids === undefined) await sleep(25)
  }
  if (pids === undefined) {
    driver.kill('SIGKILL')
    throw new Error(`driver never reported a pid: ${stderr}`)
  }
  recorded = Object.values(pids)
  if (!ready()) {
    driver.kill('SIGKILL')
    throw new Error(`driver never became ready: ${stderr}`)
  }

  return { pids, exit, kill: (signal) => driver.kill(signal) }
}

function startStepDriver(
  mode: 'wait' | 'exit' | 'daemon',
): Promise<DriverRun<{ child: number; grandchild: number }>> {
  const pidFile = path.join(cwd, 'pids.json')
  return startDriver(STEP_DRIVER, [pidFile, mode], () => fs.existsSync(pidFile))
}

function startApiDriver(mode: 'wait' | 'stop'): Promise<DriverRun<{ server: number }>> {
  const pidFile = path.join(cwd, 'pids.json')
  const readyFile = path.join(cwd, 'ready.txt')
  return startDriver(API_DRIVER, [pidFile, readyFile, mode], () => fs.existsSync(readyFile))
}

describe('process-death sweep of group-led step children', () => {
  it('SIGINT kills the step child and its grandchild, and still ends the driver by signal', async () => {
    const run = await startStepDriver('wait')
    expect(alive(run.pids.child)).toBe(true)
    expect(alive(run.pids.grandchild)).toBe(true)

    run.kill('SIGINT')

    // Re-raised with the default disposition restored: the driver dies BY the
    // signal (shell status 130), it does not swallow it and exit some other way.
    const { code, signal } = await run.exit
    expect(signal).toBe('SIGINT')
    expect(code).toBeNull()

    expect(await waitGone(run.pids.child)).toBe(true)
    expect(await waitGone(run.pids.grandchild)).toBe(true)
  }, 20_000)

  it('SIGTERM kills the whole step group', async () => {
    const run = await startStepDriver('wait')

    run.kill('SIGTERM')

    const { signal } = await run.exit
    expect(signal).toBe('SIGTERM')
    expect(await waitGone(run.pids.child)).toBe(true)
    expect(await waitGone(run.pids.grandchild)).toBe(true)
  }, 20_000)

  it('SIGHUP (terminal close) kills the whole step group', async () => {
    const run = await startStepDriver('wait')

    run.kill('SIGHUP')

    const { signal } = await run.exit
    expect(signal).toBe('SIGHUP')
    expect(await waitGone(run.pids.child)).toBe(true)
    expect(await waitGone(run.pids.grandchild)).toBe(true)
  }, 20_000)

  /**
   * The case a tester hit with a real `relkit watch` step and a real Ctrl-C: the
   * step's own command had returned minutes earlier, so the only thing left of the
   * step was the daemon holding its pipes. Deregistering the group when the DIRECT
   * child exits — which is the very moment its daemon becomes an orphan — hands the
   * sweep an empty set exactly when it has the most to do. The group must stay
   * enrolled until the STEP settles, not until its child does.
   */
  it('SIGINT kills a daemon the step left behind after its own command returned', async () => {
    const run = await startStepDriver('daemon')

    // The tester's precondition: ppid 1 by the time the signal lands.
    expect(await waitGone(run.pids.child)).toBe(true)
    expect(alive(run.pids.grandchild)).toBe(true)

    run.kill('SIGINT')

    const { signal } = await run.exit
    expect(signal).toBe('SIGINT')
    expect(await waitGone(run.pids.grandchild)).toBe(true)
  }, 20_000)

  it('a plain process.exit() sweeps too', async () => {
    const run = await startStepDriver('exit')

    const { code, signal } = await run.exit
    expect(code).toBe(0)
    expect(signal).toBeNull()

    expect(await waitGone(run.pids.child)).toBe(true)
    expect(await waitGone(run.pids.grandchild)).toBe(true)
  }, 20_000)
})

/**
 * A server outlives every step of its scenario, so a CLI killed mid-run is the one
 * case its own `stop()` never reaches.
 */
describe('process-death sweep of the api server', () => {
  it('SIGINT kills a booted api server', async () => {
    const run = await startApiDriver('wait')
    expect(alive(run.pids.server)).toBe(true)

    run.kill('SIGINT')

    const { signal } = await run.exit
    expect(signal).toBe('SIGINT')
    expect(await waitGone(run.pids.server)).toBe(true)
  }, 30_000)

  it('a normal stop() still owns the shutdown — the driver exits cleanly with nothing left to sweep', async () => {
    const run = await startApiDriver('stop')

    const { code, signal } = await run.exit
    expect(code).toBe(0)
    expect(signal).toBeNull()
    expect(alive(run.pids.server)).toBe(false)
  }, 30_000)
})
