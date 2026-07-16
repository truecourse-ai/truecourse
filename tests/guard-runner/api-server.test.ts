import { describe, it, expect } from 'vitest'
import { startApiServer, allocateFreePort, constructChildEnv } from '@truecourse/guard-runner'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FIXTURE_API_SERVER, FIXTURE_API_CRASH } from './helpers.js'

function tempCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tc-api-server-test-'))
}

/** A minimal child env (PATH only) — enough for `node` to run the fixtures. */
const ENV = constructChildEnv({ sandbox: { home: tempCwd(), tmp: tempCwd() } })

describe('allocateFreePort', () => {
  it('returns a bindable localhost port', async () => {
    const port = await allocateFreePort()
    expect(port).toBeGreaterThan(0)
  })
})

describe('startApiServer', () => {
  it('boots the fixture, injects PORT, and answers on baseUrl', async () => {
    const cwd = tempCwd()
    const result = await startApiServer({
      resolvedServe: [process.execPath, FIXTURE_API_SERVER],
      cwd,
      env: ENV,
      healthPath: '/health',
      readyTimeoutMs: 15_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    try {
      const res = await fetch(`${result.server.baseUrl}/todos`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ todos: [] })
      // The server logged its listen line — captured for evidence.
      expect(result.server.logs().stdout).toContain('todos fixture listening')
    } finally {
      await result.server.stop()
    }
    // Stopped: the port no longer answers.
    await expect(
      fetch(`${result.server.baseUrl}/health`, { signal: AbortSignal.timeout(2_000) }),
    ).rejects.toThrow()
  })

  it('a server that exits at startup fails with its captured stderr', async () => {
    const result = await startApiServer({
      resolvedServe: [process.execPath, FIXTURE_API_CRASH],
      cwd: tempCwd(),
      env: ENV,
      healthPath: '/health',
      readyTimeoutMs: 15_000,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('exited before becoming healthy')
    expect(result.stderr).toContain('fixture crash')
  })

  it('a server that never turns healthy times out and is killed', async () => {
    // The fixture requires PORT; startApiServer always sets it — point health at
    // a path the fixture 404s so it boots but never answers 2xx.
    const result = await startApiServer({
      resolvedServe: [process.execPath, FIXTURE_API_SERVER],
      cwd: tempCwd(),
      env: ENV,
      healthPath: '/never-healthy',
      readyTimeoutMs: 1_500,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('did not answer GET /never-healthy')
  })

  it('an unspawnable serve argv fails with the spawn error', async () => {
    const result = await startApiServer({
      resolvedServe: ['/definitely/not/a/binary'],
      cwd: tempCwd(),
      env: ENV,
      healthPath: '/',
      readyTimeoutMs: 5_000,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('failed to spawn')
  })
})
