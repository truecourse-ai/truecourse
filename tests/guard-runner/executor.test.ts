import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeStep } from '@truecourse/guard-runner'
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
