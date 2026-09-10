import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { runGuard, recipePath } from '@truecourse/guard-runner'
import { writeGuardExternals } from '../../packages/core/src/commands/guard-externals.js'
import { readGuardDependenciesView } from '../../packages/core/src/commands/guard-dependencies.js'
import { deriveNeedsSetup } from '@truecourse/shared'
import { apiScenario, makeTempRepo, rmrf, specBinds, writeApiRecipe, writeScenario } from '../guard-runner/helpers.js'
const repos: string[] = [],
  cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
  while (repos.length) rmrf(repos.pop()!)
})

describe('CurrencyBeacon prerequisite lifecycle through real API and browser execution', () => {
  it('keeps dependent calls blocked until provision, preserves absent/CRUD cases, and fails invalid credentials', async () => {
    const repoRoot = makeTempRepo()
    repos.push(repoRoot)
    let requests = 0,
      authenticated = 0
    const provider = http.createServer((req, res) => {
      requests++
      const ok = req.headers.authorization === 'Bearer fixture-secret'
      if (ok) authenticated++
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(ok ? { rate: 0.9 } : { error: 'Invalid key' }))
    })
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve) => provider.close(() => resolve())))
    const baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
    const serve = ['node', path.resolve('tests/fixtures/guard-credential-detection/browser-server.js')]
    writeApiRecipe(repoRoot, {
      serve,
      externals: { currencybeacon: { baseUrlEnv: 'CURRENCYBEACON_BASE_URL', env: { CURRENCYBEACON_API_KEY: {} } } },
    })
    const recipe = JSON.parse(fs.readFileSync(recipePath(repoRoot), 'utf8'))
    recipe.web = { serve, healthPath: '/health', cwd: 'repo' }
    fs.writeFileSync(recipePath(repoRoot), JSON.stringify(recipe))
    const requires = [{ dependency: 'currencybeacon', mode: 'provided' as const }]
    const base = apiScenario({
      id: 'api-success',
      binds: specBinds('cli/version'),
      steps: [
        {
          request: { method: 'GET', path: '/convert' },
          expect: { status: 200, json: { convertedAmountCents: { equals: 2250 } } },
        },
      ],
    })
    writeScenario(repoRoot, 'api/success.yaml', { ...base, prerequisites: requires })
    writeScenario(repoRoot, 'api/absent.yaml', {
      ...base,
      id: 'absent',
      prerequisites: [{ dependency: 'currencybeacon', mode: 'absent' }],
      setup: { env: { CURRENCYBEACON_API_KEY: '' } },
      steps: [{ request: { method: 'GET', path: '/convert' }, expect: { status: 503 } }],
    })
    writeScenario(repoRoot, 'web/clear.yaml', {
      ...base,
      id: 'browser-clear',
      prerequisites: requires,
      steps: [
        { driver: 'web', navigate: '/' },
        {
          driver: 'web',
          click: { role: 'button', name: 'Convert' },
          expect: { text: { contains: 'Converted: 2250' } },
        },
        { driver: 'web', fill: { label: 'Amount' }, value: '30', expect: { hidden: { text: 'Converted:' } } },
      ],
    })
    writeScenario(repoRoot, 'web/crud.yaml', {
      ...base,
      id: 'crud',
      steps: [
        { driver: 'web', navigate: '/' },
        {
          driver: 'web',
          click: { role: 'button', name: 'Save expense' },
          expect: { within: { role: 'status' }, text: { contains: 'Expense saved.' } },
        },
      ],
    })
    const view = () =>
      readGuardDependenciesView(repoRoot, { env: {} }).dependencies.find((d) => d.name === 'currencybeacon')!
    for (const incomplete of [false, true]) {
      if (incomplete)
        writeGuardExternals(repoRoot, {
          externals: { currencybeacon: { baseUrlEnv: 'CURRENCYBEACON_BASE_URL', baseUrl, baseUrlTarget: 'local' } },
        })
      const result = await runGuard({ repoRoot, skipBuild: true, stepTimeoutMs: 1000 })
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw Error(JSON.stringify(result))
      expect(result.latest.summary).toMatchObject({ pass: 2, blocked: 2, fail: 0 })
      expect(requests).toBe(0)
      expect(JSON.stringify(result)).toContain('currencybeacon')
      expect(view().state).toBe(incomplete ? 'incomplete' : 'unprovided')
    }
    writeGuardExternals(repoRoot, {
      externals: {
        currencybeacon: {
          baseUrlEnv: 'CURRENCYBEACON_BASE_URL',
          env: { CURRENCYBEACON_API_KEY: { value: 'fixture-secret' } },
        },
      },
    })
    expect(view().state).toBe('provided')
    expect(
      deriveNeedsSetup('a structured gap without service prose', { currencybeacon: 'provided' }, ['currencybeacon']),
    ).toEqual({ services: [], provided: ['currencybeacon'] })
    const supplied = await runGuard({ repoRoot, skipBuild: true, stepTimeoutMs: 1000 })
    expect(supplied.status).toBe('ok')
    if (supplied.status !== 'ok') throw Error(JSON.stringify(supplied))
    expect(supplied.latest.summary).toMatchObject({ pass: 4, blocked: 0, fail: 0 })
    expect(authenticated).toBe(2)
    expect(JSON.stringify(supplied)).not.toContain('fixture-secret')
    writeGuardExternals(repoRoot, {
      externals: {
        currencybeacon: {
          baseUrlEnv: 'CURRENCYBEACON_BASE_URL',
          env: { CURRENCYBEACON_API_KEY: { value: 'invalid-secret' } },
        },
      },
    })
    const invalid = await runGuard({ repoRoot, skipBuild: true, stepTimeoutMs: 1000 })
    expect(invalid.status).toBe('ok')
    if (invalid.status !== 'ok') throw Error(JSON.stringify(invalid))
    expect(invalid.latest.summary).toMatchObject({ pass: 2, blocked: 0, fail: 2 })
    expect(authenticated).toBe(2)
    expect(requests).toBeGreaterThanOrEqual(4)
  }, 60000)
  it('does not build or start a server when its only selected case lacks an account', async () => {
    const repoRoot = makeTempRepo()
    repos.push(repoRoot)
    writeApiRecipe(repoRoot, {
      serve: ['node', 'does-not-exist.js'],
      externals: { currencybeacon: { baseUrlEnv: 'CURRENCYBEACON_BASE_URL', env: { CURRENCYBEACON_API_KEY: {} } } },
    })
    const recipe = JSON.parse(fs.readFileSync(recipePath(repoRoot), 'utf8'))
    recipe.build = 'node does-not-exist-build.js'
    fs.writeFileSync(recipePath(repoRoot), JSON.stringify(recipe))
    writeScenario(repoRoot, 'api/blocked.yaml', {
      ...apiScenario({
        id: 'blocked',
        binds: specBinds('cli/version'),
        steps: [{ request: { method: 'GET', path: '/convert' }, expect: { status: 200 } }],
      }),
      prerequisites: [{ dependency: 'currencybeacon', mode: 'provided' }],
    })
    const result = await runGuard({ repoRoot })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw Error(JSON.stringify(result))
    expect(result.latest.summary).toMatchObject({ blocked: 1, pass: 0, fail: 0, error: 0 })
  })
})
