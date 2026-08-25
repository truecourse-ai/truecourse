/**
 * THE WORKING SANDBOX (01 step 2c) — the persistent world an agent session
 * works in across turns. Same isolation as every guard sandbox (allowlist env,
 * redirected HOME/XDG/TMP, containment); the difference is LIFETIME: what turn
 * 3 installed is still there on turn 7, through either entry point.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createWorkingSandbox, SandboxError } from '../../packages/guard-runner/src/sandbox'
import type { WorkingSandbox } from '../../packages/guard-runner/src/sandbox'

/** Canary host values that must never reach a scenario child. */
const CANARIES = {
  ANTHROPIC_API_KEY: 'leaked-anthropic-key',
  TRUECOURSE_SECRET_KEY: 'leaked-truecourse-secret',
  HTTPS_PROXY: 'http://canary-proxy.invalid:3128',
} as const

let sandbox: WorkingSandbox
let restore: Record<string, string | undefined>

beforeEach(() => {
  restore = {}
  for (const [name, value] of Object.entries(CANARIES)) {
    restore[name] = process.env[name]
    process.env[name] = value
  }
  // The shell env is built at creation time, so the canaries must be set first.
  sandbox = createWorkingSandbox()
})

afterEach(() => {
  sandbox.cleanup()
  for (const [name, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

/** `KEY=value` lines of an `env` dump, as a record. */
function parseEnv(dump: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of dump.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return out
}

describe('working sandbox persistence', () => {
  it('keeps one world across calls and across both entry points', async () => {
    await sandbox.exec(['sh', '-c', 'echo hi > f.txt'])
    expect((await sandbox.exec(['cat', 'f.txt'])).stdout.trim()).toBe('hi')

    const built = await sandbox.shell('echo x > g.txt')
    expect(built.ok).toBe(true)
    // What the shell built is there for the next exec — that is the whole point.
    expect((await sandbox.exec(['cat', 'g.txt'])).stdout.trim()).toBe('x')
    expect((await sandbox.shell('cat f.txt')).output.trim()).toBe('hi')
  })

  it('cleanup removes the whole root', () => {
    const root = sandbox.root
    expect(fs.existsSync(root)).toBe(true)
    sandbox.cleanup()
    expect(fs.existsSync(root)).toBe(false)
    // afterEach cleans up again; rmSync is force:true, so that is a no-op.
  })
})

describe('working sandbox env', () => {
  it('keeps host secrets out of both entry points and redirects HOME into the sandbox', async () => {
    const execEnv = parseEnv((await sandbox.exec(['env'])).stdout)
    const shellEnv = parseEnv((await sandbox.shell('env')).output)

    for (const env of [execEnv, shellEnv]) {
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.TRUECOURSE_SECRET_KEY).toBeUndefined()
      // HOME is the sandbox's, not the developer's — the sandbox wins over
      // the build passthrough, which names HOME too.
      expect(env.HOME?.startsWith(sandbox.root)).toBe(true)
      expect(env.TZ).toBe('UTC')
    }

    // Proxy config is the difference: an install dies without it, a scenario
    // step has no business seeing it.
    expect(shellEnv.HTTPS_PROXY).toBe(CANARIES.HTTPS_PROXY)
    expect(execEnv.HTTPS_PROXY).toBeUndefined()
  })
})

describe('working sandbox containment', () => {
  it('refuses a cwd that escapes and accepts one that does not', async () => {
    expect(() => sandbox.exec(['pwd'], { cwd: '../..' })).toThrow(SandboxError)
    expect(() => sandbox.exec(['pwd'], { cwd: '/etc' })).toThrow(SandboxError)

    fs.mkdirSync(path.join(sandbox.cwd, 'nested'), { recursive: true })
    // `pwd` reports the resolved path (macOS hangs /var off /private/var).
    const real = fs.realpathSync(sandbox.cwd)
    expect((await sandbox.exec(['pwd'], { cwd: '.' })).stdout.trim()).toBe(real)
    expect((await sandbox.exec(['pwd'], { cwd: 'nested' })).stdout.trim()).toBe(
      path.join(real, 'nested'),
    )
  })
})

describe('working sandbox lifetime controls', () => {
  it('kills the whole process group when the timeout binds', async () => {
    const started = Date.now()
    // The backgrounded sleep holds the shell's pipes; only a GROUP kill reaps it.
    const built = await sandbox.shell('sleep 60 & echo started; wait', { timeoutMs: 500 })
    expect(built.timedOut).toBe(true)
    expect(built.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(20_000)

    const capture = await sandbox.exec(['sh', '-c', 'sleep 60'], { timeoutMs: 500 })
    expect(capture.timedOut).toBe(true)
  })

  it('spawns nothing at all for an already-aborted signal', async () => {
    const signal = AbortSignal.abort()
    expect(await sandbox.shell('echo never', { signal })).toEqual({
      ok: false,
      command: 'echo never',
      exitCode: null,
      timedOut: false,
      output: '',
    })
    expect(await sandbox.exec(['sh', '-c', 'echo never > aborted.txt'], { signal })).toEqual({
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 0,
    })
    expect(fs.existsSync(path.join(sandbox.cwd, 'aborted.txt'))).toBe(false)
  })
})
