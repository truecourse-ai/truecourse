import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  executeStep,
  DEFAULT_STEP_TIMEOUT_MS,
  POST_KILL_SETTLE_GRACE_MS,
} from '@truecourse/guard-runner'
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

  it('refuses prompt-keyed answers on a step with no terminal', async () => {
    // The schema rejects this pairing before a run, so reaching it means options
    // built by hand: a pipe is never asked a question, and the answers are not
    // bytes to push into one.
    const cap = await executeStep({
      argv: ['node', FIXTURE_BIN, 'shout'],
      cwd,
      env: baseEnv,
      stdin: [{ marker: 'Publish?', answer: 'y' }],
    })
    expect(cap.spawnError).toContain('typed at a terminal')
    expect(cap.exitCode).toBeNull()
    expect(cap.stdout).toBe('')
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
    // The COMMAND overran its budget — this is not the orphaned-stdio story, and
    // the two flags are mutually exclusive so a reader can trust either one alone.
    expect(cap.orphanedStdio).toBeFalsy()
  })

  it('settles through `close` when the stdio closes with the process (no orphan flag)', async () => {
    // Only the timeout path can produce `orphanedStdio`, so its absence is the
    // proof that `close` settled this step.
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
 * that process is alive — the step must fall back on its own timeout, which kills
 * the group and closes the pipes, instead of waiting forever on output nobody is
 * going to write.
 *
 * There is deliberately NO short grace after the child's exit: a helper that is
 * merely slow to let go of the pipes is indistinguishable from a daemon until it
 * lets go, so any constant would classify healthy steps by machine load.
 */
describe('executeStep — a process that outlives the step', () => {
  /**
   * A step that leaves `helperBody` running on inherited stdio, printing the
   * helper's pid and its own — which is the process GROUP the executor spawned,
   * since the step's command leads it. `escapeGroup` makes the helper `setsid`
   * into a group of its own, out of reach of any `kill(-pgid)`.
   */
  const stepSpawning = (helperBody: string, opts: { escapeGroup?: boolean } = {}): string =>
    [
      `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(helperBody)}], { stdio: 'inherit', detached: ${opts.escapeGroup === true} })`,
      'c.unref()',
      `process.stdout.write('pid=' + c.pid + ' group=' + process.pid + '\\n')`,
    ].join(';')

  /** A daemon: outlives any plausible step budget. */
  const SILENT_HELPER = 'setTimeout(() => {}, 600000)'
  /** The healthy case: a telemetry flush / postinstall / `tee` that just takes a moment. */
  const SHORT_LIVED_HELPER = 'setTimeout(() => {}, 1400)'

  /** True while `pid` is still around (signal 0 only probes). */
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** True while ANY process is still in the group `pgid` leads. */
  const groupAlive = (pgid: number): boolean => {
    try {
      process.kill(-pgid, 0)
      return true
    } catch {
      return false
    }
  }

  const helperPid = (stdout: string): number => {
    const pid = Number(/pid=(\d+)/.exec(stdout)?.[1])
    expect(pid).toBeGreaterThan(0)
    return pid
  }

  const groupPid = (stdout: string): number => {
    const pid = Number(/group=(\d+)/.exec(stdout)?.[1])
    expect(pid).toBeGreaterThan(0)
    return pid
  }

  async function waitGone(pid: number): Promise<boolean> {
    for (let i = 0; i < 200 && alive(pid); i++) await new Promise((r) => setTimeout(r, 25))
    return !alive(pid)
  }

  /**
   * The headline case. A helper that holds the pipes SILENTLY for over a second and
   * then exits is a completely healthy step — full output, exit 0 — and no constant
   * can tell it apart from a daemon in advance. Waiting for `close` on the step's
   * own budget can, and does, at any speed and under any load.
   */
  it('waits out a slow but short-lived helper and settles through `close`', async () => {
    const cap = await executeStep({
      argv: ['node', '-e', stepSpawning(SHORT_LIVED_HELPER)],
      cwd,
      env: baseEnv,
      timeoutMs: 15_000,
    })

    expect(cap.exitCode).toBe(0)
    expect(cap.orphanedStdio).toBeUndefined()
    expect(cap.timedOut).toBe(false)
    // The step's OWN output, complete — not truncated at whatever a grace allowed.
    expect(cap.stdout).toMatch(/^pid=\d+ group=\d+\n$/)
  }, 30_000)

  it('a real daemon holds the pipes to the end of the step budget, then settles flagged and reaped', async () => {
    const timeoutMs = 1_500
    const started = Date.now()
    const cap = await executeStep({
      argv: ['node', '-e', stepSpawning(SILENT_HELPER)],
      cwd,
      env: baseEnv,
      timeoutMs,
    })
    const elapsed = Date.now() - started

    // The step's own command finished cleanly — its exit status, not the SIGKILL
    // that eventually freed the pipes, is what the capture reports.
    expect(cap.exitCode).toBe(0)
    expect(cap.orphanedStdio).toBe(true)
    // The COMMAND did not overrun anything; only its leftovers did. Reporting a
    // timeout here would blame the step for the daemon's lifetime.
    expect(cap.timedOut).toBe(false)
    expect(helperPid(cap.stdout)).toBeGreaterThan(0)

    // Bounded by the budget it was given (plus the post-kill backstop), never by
    // the 10min background process whose lifetime `close` is hostage to.
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 100)
    expect(elapsed).toBeLessThan(DEFAULT_STEP_TIMEOUT_MS)

    // The group kill that freed the pipes also reaped the daemon: nothing leaks
    // onto the host, which nothing else would have done — the sweep deregistered
    // the pid when the DIRECT child exited.
    expect(await waitGone(helperPid(cap.stdout))).toBe(true)
    // The contract stated group-wise: an orphaned settle leaves no live process
    // group behind, whichever kill got there first.
    expect(groupAlive(groupPid(cap.stdout))).toBe(false)
  }, 30_000)

  /**
   * The backstop path, which nothing else reaches. A helper that `setsid`s out of
   * the step's group is beyond `kill(-pgid)`: the timeout's group kill finds an
   * EMPTY group (ESRCH) and `armChildKill`'s `child.kill()` fallback is a no-op on
   * a child that has already exited, so the `close` the kill normally produces
   * never comes. The step must still settle — the run cannot hang on a process no
   * pgid can name.
   */
  it('settles at the backstop when the orphan escaped the process group', async () => {
    const timeoutMs = 1_000
    const started = Date.now()
    const cap = await executeStep({
      argv: ['node', '-e', stepSpawning(SILENT_HELPER, { escapeGroup: true })],
      cwd,
      env: baseEnv,
      timeoutMs,
    })
    const elapsed = Date.now() - started

    expect(cap.exitCode).toBe(0)
    expect(cap.orphanedStdio).toBe(true)
    expect(cap.timedOut).toBe(false)
    // Past the budget AND past the grace: `close` never arrived, so this is the
    // backstop settling, not the ordinary post-kill `close`.
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs + POST_KILL_SETTLE_GRACE_MS - 200)
    expect(elapsed).toBeLessThan(DEFAULT_STEP_TIMEOUT_MS)

    // Same contract as the ordinary orphan: no live group is left behind.
    expect(groupAlive(groupPid(cap.stdout))).toBe(false)

    // The escapee itself is the honest limit of pgid-based reaping — it is nobody's
    // descendant group any more, so this test owns it.
    const escapee = helperPid(cap.stdout)
    try {
      process.kill(escapee, 'SIGKILL')
    } catch {
      /* already gone */
    }
    expect(await waitGone(escapee)).toBe(true)
  }, 30_000)

  it('keeps waiting while the stdio is still producing output, then settles through `close`', async () => {
    const CHATTY_BUT_FINITE = [
      'let n = 0',
      `const t = setInterval(() => { process.stdout.write('chunk' + ++n + '\\n'); if (n === 8) clearInterval(t) }, 150)`,
    ].join(';')

    const cap = await executeStep({
      argv: ['node', '-e', stepSpawning(CHATTY_BUT_FINITE)],
      cwd,
      env: baseEnv,
    })

    // Output kept arriving well past a fixed grace measured from the child's exit.
    expect(cap.exitCode).toBe(0)
    expect(cap.orphanedStdio).toBeUndefined()
    expect(cap.timedOut).toBe(false)
    expect(cap.stdout).toContain('chunk8\n')
  })

  it('a chatty orphan is bounded the same way — flagged, reaped, never a hang', async () => {
    const NEVER_QUIET = `setInterval(() => process.stdout.write('x'), 50)`

    const started = Date.now()
    const cap = await executeStep({
      argv: ['node', '-e', stepSpawning(NEVER_QUIET)],
      cwd,
      env: baseEnv,
      timeoutMs: 1_000,
    })
    const elapsed = Date.now() - started

    expect(cap.orphanedStdio).toBe(true)
    expect(cap.timedOut).toBe(false)
    expect(elapsed).toBeLessThan(DEFAULT_STEP_TIMEOUT_MS)
    // The group kill reaches an orphan that is still writing, too.
    expect(await waitGone(helperPid(cap.stdout))).toBe(true)
  }, 20_000)
})

describe('executeStep — a held command (`until`)', () => {
  // Each stream carries its own watch: a stderr chunk landing between two stdout
  // chunks must not split the marker forever (one shared buffer did exactly that).
  it('sees a marker split across stdout chunks even when stderr interleaves', async () => {
    const SPLIT_READY = [
      "process.stdout.write('listening ')",
      "setTimeout(() => { process.stderr.write('warn: noisy\\n');" +
        " setTimeout(() => { process.stdout.write('on port 3000\\n'); setInterval(() => {}, 1000) }, 80) }, 80)",
    ].join(';')

    const cap = await executeStep({
      argv: ['node', '-e', SPLIT_READY],
      cwd,
      env: baseEnv,
      until: 'listening on',
      timeoutMs: 8_000,
    })
    expect(cap.endedAtMarker).toBe('listening on')
    expect(cap.unseenMarker).toBeUndefined()
    expect(cap.timedOut).toBe(false)
  })

  it('finds the ready line on stderr too', async () => {
    const STDERR_READY = "process.stderr.write('listening on 4000\\n'); setInterval(() => {}, 1000)"
    const cap = await executeStep({
      argv: ['node', '-e', STDERR_READY],
      cwd,
      env: baseEnv,
      until: 'listening on',
      timeoutMs: 8_000,
    })
    expect(cap.endedAtMarker).toBe('listening on')
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
