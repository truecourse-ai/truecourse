import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeStep, DEFAULT_STEP_TIMEOUT_MS, STDIO_DRAIN_GRACE_MS } from '@truecourse/guard-runner'
import { FIXTURE_BIN } from './helpers.js'

let cwd: string
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-exec-'))
})
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
})

const baseEnv = { ...process.env, NO_COLOR: '1' }

describe('executeStep', () => {
  it('captures stdout and a zero exit', async () => {
    const cap = await executeStep({ argv: ['node', FIXTURE_BIN, '--version'], cwd, env: baseEnv })
    expect(cap.exitCode).toBe(0)
    expect(cap.stdout).toBe('2.4.1\n')
    expect(cap.stderr).toBe('')
    expect(cap.timedOut).toBe(false)
    expect(cap.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('captures stderr and a non-zero exit', async () => {
    const cap = await executeStep({ argv: ['node', FIXTURE_BIN, 'boom'], cwd, env: baseEnv })
    expect(cap.exitCode).toBe(7)
    expect(cap.stderr).toContain('intentional failure')
  })

  it('feeds stdin', async () => {
    const cap = await executeStep({
      argv: ['node', FIXTURE_BIN, 'shout'],
      cwd,
      env: baseEnv,
      stdin: 'quiet please\n',
    })
    expect(cap.stdout).toBe('QUIET PLEASE\n')
  })

  it('enforces the per-step timeout (kills a hanging process)', async () => {
    const cap = await executeStep({
      argv: ['node', FIXTURE_BIN, 'hang'],
      cwd,
      env: baseEnv,
      timeoutMs: 400,
    })
    expect(cap.timedOut).toBe(true)
    expect(cap.exitCode).toBeNull()
  })

  it('settles through `close` when the stdio closes with the process (no orphan flag)', async () => {
    // The grace path is the ONLY producer of `orphanedStdio`, so its absence is
    // the proof that `close` — not the drain timer — settled this step.
    const cap = await executeStep({ argv: ['node', FIXTURE_BIN, '--version'], cwd, env: baseEnv })
    expect(cap.orphanedStdio).toBeUndefined()
  })

  it('reports a spawn failure without throwing', async () => {
    const cap = await executeStep({
      argv: ['this-binary-does-not-exist-xyz', 'arg'],
      cwd,
      env: baseEnv,
    })
    expect(cap.spawnError).toBeDefined()
    expect(cap.exitCode).toBeNull()
  })
})

/**
 * The shape that hangs a run: a program that starts a background process with
 * INHERITED stdio and returns. The pipes outlive it, so `close` never fires while
 * that process is alive — the step must settle on `exit` + the drain grace instead
 * of waiting on output nobody is going to write.
 */
describe('executeStep — a process that outlives the step', () => {
  const ORPHAN_SCRIPT = [
    "const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit' })",
    'c.unref()',
    'process.stdout.write(String(c.pid))',
  ].join(';')

  /** True while `pid` is still around (signal 0 only probes). */
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  it('settles within the drain grace and flags the orphaned stdio', async () => {
    const started = Date.now()
    const cap = await executeStep({ argv: ['node', '-e', ORPHAN_SCRIPT], cwd, env: baseEnv })
    const elapsed = Date.now() - started

    expect(cap.exitCode).toBe(0)
    expect(cap.orphanedStdio).toBe(true)
    expect(cap.timedOut).toBe(false)
    // The grace ended the wait — not the step timeout, and not the 60s background
    // process whose lifetime `close` would have been hostage to.
    expect(elapsed).toBeLessThan(STDIO_DRAIN_GRACE_MS * 4)
    expect(elapsed).toBeLessThan(DEFAULT_STEP_TIMEOUT_MS)

    // What the program printed before exiting is still captured.
    const pid = Number(cap.stdout.trim())
    expect(pid).toBeGreaterThan(0)

    // Nothing reaps a background process the step left behind on the happy path
    // (the kill timer was disarmed) — this test owns it.
    process.kill(pid, 'SIGKILL')
    for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 25))
    expect(alive(pid)).toBe(false)
  })
})

describe('executeStep — abort signal', () => {
  it('a pre-aborted signal short-circuits without spawning the command', async () => {
    const marker = path.join(cwd, 'ran.txt')
    const ac = new AbortController()
    ac.abort()
    const cap = await executeStep({
      argv: ['node', '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
      cwd,
      env: baseEnv,
      signal: ac.signal,
    })
    expect(cap.exitCode).toBeNull()
    expect(cap.timedOut).toBe(false)
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('a pre-aborted signal never attempts the spawn at all (no spawnError even for a missing binary)', async () => {
    const ac = new AbortController()
    ac.abort()
    const cap = await executeStep({
      argv: ['this-binary-does-not-exist-xyz', 'arg'],
      cwd,
      env: baseEnv,
      signal: ac.signal,
    })
    // Had the child been spawned, the ENOENT 'error' event would set spawnError.
    expect(cap.spawnError).toBeUndefined()
    expect(cap.exitCode).toBeNull()
    expect(cap.timedOut).toBe(false)
  })
})
