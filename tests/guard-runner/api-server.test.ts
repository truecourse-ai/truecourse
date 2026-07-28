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

  it('substitutes ${PORT} into the serve argv — the uvicorn/ASP.NET shape', async () => {
    const serve = [process.execPath, FIXTURE_API_SERVER, '--port', '${PORT}']
    const result = await startApiServer({
      resolvedServe: serve,
      cwd: tempCwd(),
      env: ENV,
      healthPath: '/health',
      readyTimeoutMs: 15_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    try {
      const boot = (await (await fetch(`${result.server.baseUrl}/boot`)).json()) as {
        port: number
        argv: string[]
      }
      // The fixture bound the port it was told to on the COMMAND LINE.
      expect(boot.port).toBe(result.server.port)
      expect(boot.argv).toEqual(['--port', String(result.server.port)])
      // The template is untouched — the recipe object is never mutated.
      expect(serve[3]).toBe('${PORT}')
    } finally {
      await result.server.stop()
    }
  })

  it('substitutes ${PORT} into env values (ASPNETCORE_URLS shape)', async () => {
    const result = await startApiServer({
      resolvedServe: [process.execPath, FIXTURE_API_SERVER],
      cwd: tempCwd(),
      env: { ...ENV, TC_URLS: 'http://127.0.0.1:${PORT}', TC_PLAIN: 'no placeholder' },
      healthPath: '/health',
      readyTimeoutMs: 15_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    try {
      const boot = (await (await fetch(`${result.server.baseUrl}/boot`)).json()) as {
        env: Record<string, string>
      }
      expect(boot.env.TC_URLS).toBe(`http://127.0.0.1:${result.server.port}`)
      expect(boot.env.TC_PLAIN).toBe('no placeholder')
    } finally {
      await result.server.stop()
    }
  })

  it('two servers from ONE template each get their own port', async () => {
    const opts = {
      resolvedServe: [process.execPath, FIXTURE_API_SERVER, '--port', '${PORT}'],
      env: { ...ENV, TC_URLS: 'http://127.0.0.1:${PORT}' },
      healthPath: '/health',
      readyTimeoutMs: 15_000,
    }
    const [a, b] = await Promise.all([
      startApiServer({ ...opts, cwd: tempCwd() }),
      startApiServer({ ...opts, cwd: tempCwd() }),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    try {
      expect(a.server.port).not.toBe(b.server.port)
      const bootOf = async (base: string) =>
        (await (await fetch(`${base}/boot`)).json()) as { port: number; env: Record<string, string> }
      const bootA = await bootOf(a.server.baseUrl)
      const bootB = await bootOf(b.server.baseUrl)
      expect(bootA.port).toBe(a.server.port)
      expect(bootB.port).toBe(b.server.port)
      expect(bootA.env.TC_URLS).toBe(`http://127.0.0.1:${a.server.port}`)
      expect(bootB.env.TC_URLS).toBe(`http://127.0.0.1:${b.server.port}`)
    } finally {
      await Promise.all([a.server.stop(), b.server.stop()])
    }
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
