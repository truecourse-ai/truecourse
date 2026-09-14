import { afterEach, describe, expect, it } from 'vitest'
import { GuardSetupSchema, GuardVerificationSchema, verificationCapabilityGap, type GuardPrerequisiteTarget } from '@truecourse/shared'
import { startExternalProxies, startHttpStubs, resolveProviderControl, scenarioProviderControlProblems, providerControlStateMaterial, type Recipe } from '@truecourse/guard-runner'

const close: (() => Promise<void>)[] = []
afterEach(async () => { while (close.length) await close.pop()!() })
const control = { service: 'Vendor', operations: ['response', 'call-count'] as const }
const requirement = { ...control, operations: [...control.operations] }
const targets: GuardPrerequisiteTarget[] = [{ name: 'vendor-account', aliases: [], credentialEnv: ['KEY'], state: 'unprovided', registerIn: 'local.json', providers: [{ service: 'vendor', baseUrlEnvs: ['BASE', 'AUTH'] }] }]
const recipe = { api: { externals: { vendor: { baseUrlEnv: 'BASE', endpoints: { AUTH: 'http://127.0.0.1:1' } } } } } as Recipe

describe('provider classification and realization', () => {
  it('requires structured provider identity, supports only API/web, and preserves legacy gaps', () => {
    const verification = { method: 'behavior', observable: 'chosen quote', cases: [{ id: 'quote', claim: 'chosen quote', method: 'behavior', requires: ['provider-control'], conditions: [], requestBoundary: 'app-to-provider', providerControls: [requirement] }] }
    const parsed = GuardVerificationSchema.parse(verification)
    expect(verificationCapabilityGap(parsed, 'api')).toBeUndefined()
    expect(verificationCapabilityGap(parsed, 'web')).toBeUndefined()
    expect(verificationCapabilityGap(parsed, 'cli')).toContain('provider-control')
    expect(GuardVerificationSchema.safeParse({ ...verification, cases: [{ ...verification.cases[0], providerControls: [] }] }).success).toBe(false)
    for (const capability of ['own-request-control', 'request-control']) {
      const legacy = GuardVerificationSchema.parse({ ...verification, cases: [{ ...verification.cases[0], requires: [capability], providerControls: undefined, requestBoundary: undefined }] })
      expect(verificationCapabilityGap(legacy, 'web')).toContain(capability)
    }
  })
  it('resolves provider names separately from accounts and rejects unknown or local targets', () => {
    expect(resolveProviderControl(requirement, 'web', targets, recipe)).toMatchObject({ service: 'vendor', realization: 'stub', baseUrlEnvs: ['AUTH', 'BASE'], credentialEnv: ['KEY'] })
    expect(resolveProviderControl(requirement, 'web', [{ ...targets[0], state: 'provided' }], recipe)).toMatchObject({ realization: 'proxy' })
    expect(resolveProviderControl(requirement, 'api', [{ ...targets[0], providers: undefined }], recipe)).toHaveProperty('problem')
    expect(resolveProviderControl({ ...requirement, service: 'unknown' }, 'api', targets, recipe)).toHaveProperty('problem')
  })
  it('requires strict scripts on every URL and changes reuse on account availability or wiring', () => {
    const setup = { env: { BASE: '${HTTP_STUB:v}', AUTH: '${HTTP_STUB:v}' }, http: { v: { routes: [{ method: 'GET' as const, path: '/', calls: 1 }] } } }
    expect(scenarioProviderControlProblems([requirement], 'web', targets, recipe, { setup })).toEqual([])
    expect(scenarioProviderControlProblems([requirement], 'api', targets, recipe, { setup: { ...setup, env: { BASE: '${HTTP_STUB:v}' } } }).join()).toContain('AUTH')
    const provided = [{ ...targets[0], state: 'provided' as const }]
    expect(scenarioProviderControlProblems([requirement], 'web', provided, recipe, { setup }).join()).toContain('selected proxy')
    expect(scenarioProviderControlProblems([requirement], 'web', provided, recipe, { setup: { externals: { vendor: { unmatched: 'error', calls: 1, faults: [{ respond: { status: 200, json: { rate: 2 } } }] } } } })).toEqual([])
    expect(providerControlStateMaterial([requirement], 'api', targets, recipe)).not.toBe(providerControlStateMaterial([requirement], 'api', provided, recipe))
    expect(providerControlStateMaterial([requirement], 'api', targets, recipe)).not.toBe(providerControlStateMaterial([requirement], 'api', targets, { api: { externals: { vendor: { baseUrlEnv: 'NEW_BASE' } } } } as Recipe))
  })
})

async function scripted(kind: 'stub' | 'proxy', routes: Record<string, unknown>[]) {
  if (kind === 'stub') {
    const h = (await startHttpStubs(GuardSetupSchema.parse({ http: { v: { routes } } }).http))!
    close.push(h.stop)
    return { url: h.origins.get('v')!, settle: () => h.settle(), stop: h.stop }
  }
  const faults = routes.map(({ method, path, calls: _calls, status, headers, json, body, ...rule }) => ({ ...rule, match: { method, path }, ...(rule.refuse ? {} : { respond: { status: status ?? 200, headers, json, body } }) }))
  const h = (await startExternalProxies({ targets: [{ service: 'v', endpoints: [{ envVar: 'BASE', url: 'http://127.0.0.1:1' }] }], scripts: GuardSetupSchema.parse({ externals: { v: { unmatched: 'error', calls: routes.reduce((n, r) => n + Number(r.calls ?? 0), 0), faults } } }).externals }))!
  close.push(h.stop)
  return { url: h.env.BASE, settle: () => h.settle(), stop: h.stop }
}

for (const kind of ['stub', 'proxy'] as const) describe(`${kind} controlled responses`, () => {
  it('consumes a delayed one-shot before a concurrent second call, with request assertions', async () => {
    const h = await scripted(kind, [
      { method: 'GET', path: '/quote', once: true, delayMs: 100, status: 429, json: { quota: true }, expect: { query: { key: 'synthetic' } }, calls: 1 },
      { method: 'GET', path: '/quote', json: { rate: 0.91 }, calls: 1 },
    ])
    const first = fetch(`${h.url}/quote?key=synthetic`)
    // Start the next call only after the server received the first, while its headers remain delayed.
    await new Promise(r => setTimeout(r, 30))
    const second = await fetch(`${h.url}/quote`)
    expect(await second.json()).toEqual({ rate: 0.91 })
    expect((await first).status).toBe(429)
    expect(h.settle()).toBeNull()
  })
  it('flushes headers before a delayed body and stops pending work when closed', async () => {
    const h = await scripted(kind, [{ method: 'GET', path: '/', bodyDelayMs: 600000, body: 'late', calls: 1 }])
    const res = await fetch(h.url)
    expect(res.status).toBe(200)
    const body = res.text()
    const rejected = expect(body).rejects.toThrow()
    await h.stop()
    await rejected
  })
  it('supports redirect and malformed data while distinguishing a reset from HTTP errors', async () => {
    const h = await scripted(kind, [
      { method: 'GET', path: '/redirect', status: 302, headers: { Location: '/bad' }, calls: 1 },
      { method: 'GET', path: '/bad', body: 'not JSON', calls: 1 },
      { method: 'GET', path: '/reset', refuse: true, calls: 1 },
    ])
    const res = await fetch(`${h.url}/redirect`)
    expect(await res.text()).toBe('not JSON')
    await expect(fetch(`${h.url}/reset`)).rejects.toThrow()
    expect(h.settle()).toBeNull()
  })
  it('fails evidence for an unexpected request or incorrect request assertion', async () => {
    const h = await scripted(kind, [{ method: 'GET', path: '/quote', expect: { query: { unit: 'USD' } }, calls: 1 }])
    await fetch(`${h.url}/quote?unit=EUR`)
    expect(h.settle()).toMatchObject({ kind: 'expect' })
    const unknown = await scripted(kind, [{ method: 'GET', path: '/quote', calls: 0 }])
    await fetch(`${unknown.url}/unexpected`).catch(() => undefined)
    expect(unknown.settle()).toMatchObject({ kind: 'unmatched' })
  })
})

it('selects proxy rules by endpoint and rejects misspelled endpoint names before boot', async () => {
  const targets = [{ service: 'v', endpoints: [{ envVar: 'AUTH', url: 'http://127.0.0.1:1' }, { envVar: 'DATA', url: 'http://127.0.0.1:1' }] }]
  await expect(startExternalProxies({ targets, scripts: { v: { faults: [{ match: { endpoint: 'TYPO' }, refuse: true }] } } })).rejects.toThrow()
  const h = (await startExternalProxies({ targets, scripts: { v: { unmatched: 'error', calls: 2, faults: [{ match: { endpoint: 'AUTH' }, respond: { status: 401 } }, { match: { endpoint: 'DATA' }, respond: { status: 200, json: { rate: 2 } } }] } } }))!
  close.push(h.stop)
  expect((await fetch(h.env.AUTH)).status).toBe(401)
  expect(await (await fetch(h.env.DATA)).json()).toEqual({ rate: 2 })
  expect(h.settle()).toBeNull()
})

it('rejects zero-call evidence for response operations while retaining explicit no-call contracts', () => {
  const setup = { env: { BASE: '${HTTP_STUB:v}', AUTH: '${HTTP_STUB:v}' }, http: { v: { routes: [{ method: 'GET' as const, path: '/', calls: 0 }] } } }
  expect(scenarioProviderControlProblems([requirement], 'api', targets, recipe, { setup }).join()).toContain('at least 1 observed call')
  expect(scenarioProviderControlProblems([{ service: 'vendor', operations: ['call-count'] }], 'api', targets, recipe, { setup })).toEqual([])
  expect(scenarioProviderControlProblems([requirement], 'api', [{ ...targets[0], state: 'provided' }], recipe, { setup: { externals: { vendor: { unmatched: 'error', calls: 0, faults: [{ respond: { status: 200 } }] } } } }).join()).toContain('at least 1 observed call')
})
