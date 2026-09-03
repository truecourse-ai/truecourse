/**
 * RUN UNTIL A MARKER — the step that can hold a command that never returns.
 *
 * The subject is `relkit serve`: it prints a banner, then a ready line, then holds
 * the terminal forever. Without `until` the only outcome available to such a step
 * is its whole budget spent and a SIGKILL, reported as an infrastructure error that
 * stops the scenario — so a documented console-mode command could only ever be the
 * LAST step of a flow, red by timeout.
 *
 * What each block pins:
 *  - the marker ends the step, the step PASSES, and the steps after it still run;
 *  - the expectation is evaluated against the output produced SO FAR;
 *  - the child is really gone (the fixture records its own pid);
 *  - a marker that never appears is a FAIL naming it — a finding about what the
 *    command printed, never an infrastructure timeout;
 *  - the same holds on a pseudo-terminal, which is where a console-mode command
 *    actually lives;
 *  - the transcript says the step was stopped at its marker, not killed.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** True while the process is alive (signal 0 probes without delivering anything). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function run(r: string, id: string) {
  const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: id })
  if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
  return res.latest.scenarios[0]
}

/** The transcript of a scenario's run. */
function transcript(r: string, evidencePath: string): string {
  return fs.readFileSync(path.join(r, evidencePath, 'transcript.txt'), 'utf-8')
}

describe('a held command stopped at its marker', () => {
  it('passes on the output so far, and the scenario CONTINUES past it', async () => {
    const r = repo()
    writeRecipe(r)
    const pidFile = path.join(r, 'serve.pid')
    writeScenario(
      r,
      'serve.yaml',
      scenario({
        id: 'serve',
        setup: { env: { TC_SERVE_PIDFILE: pidFile } },
        steps: [
          {
            run: ['serve'],
            until: { marker: 'listening on' },
            timeoutMs: 10_000,
            expect: { stdout: { contains: 'relkit serve: listening on' } },
          },
          // The step after it — the whole reason `until` exists. A console-mode
          // step that could only time out had to be a flow's last step.
          { run: ['version'], expect: { exit: 0, stdout: { contains: '2.4.1' } } },
        ],
      }),
    )

    const row = await run(r, 'serve')
    expect(row.outcome).toBe('pass')
    // Stopped AT the marker, not at the budget: a killed-at-timeout step would
    // have spent all ten seconds.
    expect(row.durationMs).toBeLessThan(9_000)

    // The child is gone — this is the OS's answer, from the pid the fixture wrote.
    const pid = Number(fs.readFileSync(pidFile, 'utf-8'))
    expect(Number.isInteger(pid)).toBe(true)
    expect(isAlive(pid)).toBe(false)
  })

  it('reads as “stopped at its marker” in the transcript, never as killed', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'serve.yaml',
      scenario({
        id: 'serve',
        steps: [
          {
            run: ['serve'],
            until: { marker: 'listening on' },
            timeoutMs: 10_000,
            expect: { output: { contains: 'Press Ctrl-C to stop' } },
          },
        ],
      }),
    )
    const row = await run(r, 'serve')
    expect(row.outcome).toBe('pass')
    const text = transcript(r, row.evidencePath!)
    expect(text).toContain('until:   stopped at "listening on"')
    expect(text).toContain('exit:    (stopped at its marker)')
    expect(text).not.toContain('[timed out]')
  })

  it('an unmet expectation on the output so far is still a plain fail', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'serve.yaml',
      scenario({
        id: 'serve',
        steps: [
          {
            run: ['serve'],
            until: { marker: 'listening on' },
            timeoutMs: 10_000,
            expect: { stdout: { contains: 'listening on 0.0.0.0' } },
          },
        ],
      }),
    )
    const row = await run(r, 'serve')
    expect(row.outcome).toBe('fail')
    expect(row.failure?.expected).toContain('0.0.0.0')
  })

  it('a marker that never appears FAILS naming it — not an infrastructure timeout', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'quiet.yaml',
      scenario({
        id: 'quiet',
        setup: { env: { RELKIT_SERVE_QUIET: '1' } },
        steps: [
          {
            run: ['serve'],
            until: { marker: 'listening on' },
            timeoutMs: 1_500,
            expect: { stdout: { contains: 'starting' } },
          },
        ],
      }),
    )
    const row = await run(r, 'quiet')
    // The documented line the step waits for was never printed: that is DRIFT in
    // what the command says, exactly like a prompt that is never asked.
    expect(row.outcome).toBe('fail')
    expect(row.failure?.expected).toContain('listening on')
    expect(row.failure?.actual).toContain('never')
    // …and what the command DID print rides with it.
    expect(row.failure?.stdout).toContain('relkit serve: starting')
  })

  it('holds a PSEUDO-TERMINAL the same way — where a console-mode command lives', async () => {
    const r = repo()
    writeRecipe(r)
    const pidFile = path.join(r, 'serve-tty.pid')
    writeScenario(
      r,
      'servetty.yaml',
      scenario({
        id: 'servetty',
        setup: { env: { TC_SERVE_PIDFILE: pidFile } },
        steps: [
          {
            run: ['serve'],
            tty: true,
            until: { marker: 'listening on' },
            timeoutMs: 10_000,
            expect: { output: { contains: 'Press Ctrl-C to stop' } },
          },
          { run: ['version'], expect: { exit: 0 } },
        ],
      }),
    )
    const row = await run(r, 'servetty')
    expect(row.outcome).toBe('pass')
    expect(row.durationMs).toBeLessThan(9_000)
    expect(isAlive(Number(fs.readFileSync(pidFile, 'utf-8')))).toBe(false)
  })

  it('a marker that never appears on a TERMINAL fails the same way', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'quiettty.yaml',
      scenario({
        id: 'quiettty',
        setup: { env: { RELKIT_SERVE_QUIET: '1' } },
        steps: [
          {
            run: ['serve'],
            tty: true,
            until: { marker: 'listening on' },
            timeoutMs: 1_500,
            expect: { output: { contains: 'starting' } },
          },
        ],
      }),
    )
    const row = await run(r, 'quiettty')
    expect(row.outcome).toBe('fail')
    expect(row.failure?.expected).toContain('listening on')
  })
})
