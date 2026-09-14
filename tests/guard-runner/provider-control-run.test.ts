import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { runGuard, recipePath, externalsLocalPath } from '@truecourse/guard-runner'
import { apiScenario, makeTempRepo, rmrf, specBinds, writeApiRecipe, writeScenario } from './helpers.js'

const repos: string[] = [], close: (() => Promise<void>)[] = []
afterEach(async () => { while (close.length) await close.pop()!(); while (repos.length) rmrf(repos.pop()!) })

for (const driver of ['api', 'web'] as const) describe(`${driver} provider control through runGuard`, () => {
  for (const provided of [false, true]) it(`uses ${provided ? 'a provided proxy' : 'an account-free stub'} for chosen success data and settles request evidence`, async () => {
    const root = makeTempRepo(); repos.push(root)
    let liveHits = 0
    const live = http.createServer((_req, res) => { liveHits++; res.end('{"rate":99}') })
    await new Promise<void>(r => live.listen(0, '127.0.0.1', r))
    close.push(() => new Promise<void>(r => live.close(() => r())))
    const liveUrl = `http://127.0.0.1:${(live.address() as AddressInfo).port}`
    const serve = ['node', path.resolve('tests/fixtures/guard-credential-detection/browser-server.js')]
    writeApiRecipe(root, { serve, externals: { currencybeacon: { baseUrlEnv: 'CURRENCYBEACON_BASE_URL', env: { CURRENCYBEACON_API_KEY: {} } } } })
    const recipe = JSON.parse(fs.readFileSync(recipePath(root), 'utf8'))
    // A surface default must not win over the per-scenario proxy or stub origin.
    recipe.web = { serve, healthPath: '/health', cwd: 'repo', env: { CURRENCYBEACON_BASE_URL: liveUrl } }
    fs.writeFileSync(recipePath(root), JSON.stringify(recipe))
    if (provided) fs.writeFileSync(externalsLocalPath(root), JSON.stringify({ currencybeacon: { baseUrl: liveUrl, env: { CURRENCYBEACON_API_KEY: 'provided-fixture-secret' } } }))
    const base = apiScenario({ id: 'controlled', binds: specBinds('cli/version'), steps: driver === 'api' ? [
      { request: { method: 'GET', path: '/convert' }, expect: { status: 200, json: { convertedAmountCents: { equals: 2250 } } } },
    ] : [
      { driver: 'web', navigate: '/' },
      { driver: 'web', click: { role: 'button', name: 'Convert' }, expect: { text: { contains: 'Converted: 2250' } } },
    ] })
    const makeSetup = (calls: number) => provided ? { externals: { currencybeacon: { unmatched: 'error', calls, faults: [{ match: { method: 'GET', path: '/v1/latest' }, expect: { headers: { authorization: 'Bearer provided-fixture-secret' } }, respond: { status: 200, json: { rate: 0.9 } } }] } } } : {
      env: { CURRENCYBEACON_BASE_URL: '${HTTP_STUB:beacon}', CURRENCYBEACON_API_KEY: 'synthetic-fixture-secret' },
      http: { beacon: { routes: [{ method: 'GET', path: '/v1/latest', json: { rate: 0.9 }, expect: { headers: { authorization: 'Bearer synthetic-fixture-secret' } }, calls }] } },
    }
    writeScenario(root, `${driver}/controlled.yaml`, { ...base, setup: makeSetup(1) })
    const result = await runGuard({ repoRoot: root, skipBuild: true })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error(JSON.stringify(result))
    expect(result.latest.scenarios[0].outcome, JSON.stringify(result.latest.scenarios)).toBe('pass')
    expect(liveHits).toBe(0)
    // Matching UI/API output alone is insufficient: a wrong provider call count fails.
    writeScenario(root, `${driver}/controlled.yaml`, { ...base, setup: makeSetup(2) })
    const wrong = await runGuard({ repoRoot: root, skipBuild: true })
    expect(wrong.status).toBe('ok')
    if (wrong.status !== 'ok') throw new Error(JSON.stringify(wrong))
    expect(wrong.latest.scenarios[0].outcome).toBe('fail')
    expect(JSON.stringify(wrong)).not.toContain(provided ? 'provided-fixture-secret' : 'synthetic-fixture-secret')
    expect(liveHits).toBe(0)
  }, 60000)
})

for (const driver of ['api', 'web'] as const) for (const provided of [false, true]) it(`${driver}/${provided ? 'proxy' : 'stub'} preserves controlled errors, redirects, timeouts and retry sequences`, async () => {
  const root = makeTempRepo(); repos.push(root)
  const serve = ['node', path.resolve('tests/fixtures/guard-provider-control/server.mjs')]
  writeApiRecipe(root, { serve, externals: { provider: { baseUrlEnv: 'PROVIDER_BASE', env: { PROVIDER_KEY: {} } } } })
  const recipe = JSON.parse(fs.readFileSync(recipePath(root), 'utf8'))
  recipe.web = { serve, healthPath: '/health', cwd: 'repo' }
  fs.writeFileSync(recipePath(root), JSON.stringify(recipe))
  if (provided) fs.writeFileSync(externalsLocalPath(root), JSON.stringify({ provider: { baseUrl: 'http://127.0.0.1:1', env: { PROVIDER_KEY: 'synthetic-key' } } }))
  const cases = [
    { name: 'unauthorized', message: 'Provider status 401', rules: [{ status: 401 }] },
    { name: 'quota', message: 'Provider status 429', rules: [{ status: 429 }] },
    { name: 'headers-timeout', message: 'Provider unavailable', rules: [{ delayMs: 600000, json: { rate: 1 } }] },
    { name: 'body-timeout', message: 'Provider unavailable', rules: [{ bodyDelayMs: 600000, json: { rate: 1 } }] },
    { name: 'reset', message: 'Provider unavailable', rules: [{ refuse: true }] },
    { name: 'invalid-json', message: 'Provider unavailable', rules: [{ body: 'broken' }] },
    { name: 'invalid-shape', message: 'Provider unavailable', rules: [{ json: { rate: 'wrong' } }] },
    { name: 'redirect', message: 'Converted: 2250', rules: [{ status: 302, headers: { location: '/final' }, once: true }, { path: '/final', json: { rate: 0.9 } }] },
    { name: 'retry', message: 'Converted: 2250', rules: [{ status: 503, once: true }, { json: { rate: 0.9 } }] },
  ]
  for (const c of cases) {
    const env = { RETRY: c.name === 'retry' ? '1' : '0', ...(provided ? {} : { PROVIDER_KEY: 'synthetic-key', PROVIDER_BASE: '${HTTP_STUB:v}' }) }
    const routes = c.rules.map(r => ({ method: 'GET', path: '/rate', calls: 1, ...r }))
    const setup = provided ? { env, externals: { provider: { unmatched: 'error', calls: c.rules.length, faults: routes.map(({ method, path, calls: _calls, delayMs, bodyDelayMs, refuse, once, ...response }: any) => ({ match: { method, path }, delayMs, bodyDelayMs, refuse, once, ...(refuse ? {} : { respond: { status: 200, ...response } }) })) } } } : { env, http: { v: { routes } } }
    writeScenario(root, `${driver}/${c.name}.yaml`, apiScenario({ id: c.name, binds: specBinds('cli/version'), setup, steps: driver === 'api' ? [
      { request: { method: 'GET', path: '/convert' }, expect: { status: c.message.startsWith('Converted') ? 200 : 502, json: { message: { equals: c.message } } } },
    ] : [
      { driver: 'web', navigate: '/' },
      { driver: 'web', click: { role: 'button', name: 'Convert' }, expect: { text: { contains: c.message } } },
    ] }))
  }
  const result = await runGuard({ repoRoot: root, skipBuild: true })
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  expect(result.latest.scenarios.map(s => [s.id, s.outcome]), JSON.stringify(result.latest.scenarios.filter(s => s.outcome !== 'pass'))).toEqual(expect.arrayContaining(cases.map(c => [c.name, 'pass'])))
}, 60000)

it('blocks saved ambiguous request-count evidence while an independent scenario still executes', async () => {
  const { GuardFlowsFileSchema, flowFingerprint } = await import('@truecourse/shared')
  const root = makeTempRepo(); repos.push(root)
  const serve = ['node', path.resolve('tests/fixtures/guard-provider-control/server.mjs')]
  writeApiRecipe(root, { serve, healthPath: '/health' })
  const milestones = [{ order: 1, doc: 'docs/spec.md', anchor: 'cli/version', claimTitle: 'Conversion requests', proofDrivers: ['api'], verification: {
    scope: 'api', method: 'behavior', observable: 'Request evidence', cases: [
      { id: 'count', claim: 'Count requests', method: 'behavior', requires: ['http', 'provider-control'], conditions: [], providerControls: [{ service: 'provider', operations: ['call-count'] }] },
      { id: 'health', claim: 'Health responds', method: 'behavior', requires: ['http'], conditions: [] },
    ],
  } }]
  const corpus = GuardFlowsFileSchema.parse({ version: 1, generatedAt: new Date().toISOString(), flows: [{
    id: 'convert', title: 'Convert', goal: 'Convert', fingerprint: 'sha256:temporary', milestones,
    bindings: [{ doc: 'docs/spec.md', anchor: 'cli/version', fingerprint: specBinds('cli/version')[0].fingerprint }], composedOf: [], synthesisInputsHash: 'inputs',
  }] })
  corpus.flows[0].fingerprint = flowFingerprint(corpus.flows[0].milestones)
  fs.mkdirSync(path.join(root, '.truecourse/scenarios'), { recursive: true })
  fs.writeFileSync(path.join(root, '.truecourse/scenarios/flows.json'), JSON.stringify(corpus))
  for (const check of ['count', 'health']) writeScenario(root, `api/${check}.yaml`, apiScenario({ id: check, binds: specBinds('cli/version'), flow: { id: 'convert', fingerprint: corpus.flows[0].fingerprint }, steps: [
    { request: { method: 'GET', path: '/health' }, expect: { status: 200 }, milestone: 1, checks: [check] },
  ] }))
  const result = await runGuard({ repoRoot: root, skipBuild: true })
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') throw new Error(JSON.stringify(result))
  expect(result.latest.scenarios.find(s => s.id === 'count')).toMatchObject({ outcome: 'blocked', failure: { actual: expect.stringContaining('Re-extract') } })
  expect(result.latest.scenarios.find(s => s.id === 'health')).toMatchObject({ outcome: 'pass' })
})
