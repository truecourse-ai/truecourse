/**
 * THE SUPPLIED-INSTANCE VOCABULARY, api driver.
 *
 * `${supplied:<name>.<field>}` is ONE vocabulary, not a cli feature: wherever
 * scenario text is interpreted — an argv, an env value, a seeded file, an HTTP
 * request, an expectation — a registered instance's value must land there. These
 * are the api-side halves the cli driver has always had.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeApiRecipe, writeScenario, apiScenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function writeCatalog(r: string, dependencies: unknown[]): void {
  const file = path.join(r, '.truecourse', 'scenarios', 'dependencies.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ dependencies }, null, 2))
}

function writeLocal(r: string, local: unknown): void {
  const file = path.join(r, '.truecourse', 'scenarios', 'dependencies.local.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(local, null, 2))
}

/** An env-shaped supplied entry: one legal env identifier, one registration field. */
const ACCOUNT = {
  name: 'vendor-account',
  class: 'supplied',
  summary: 'a vendor account the service talks to',
  registration: {
    kind: 'env',
    vars: [
      { name: 'TC_SUPPLIED_KEY', description: 'the account key', secret: true },
      { name: 'region', description: 'the account region', secret: false },
    ],
  },
  needs: [{ flowId: 'api', need: 'a vendor account the probe reaches' }],
}

describe('api driver — ${supplied:…} reaches a run', () => {
  it('substitutes a registered value into a request and into an expectation', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCatalog(r, [ACCOUNT])
    writeLocal(r, { 'vendor-account': { env: { TC_SUPPLIED_KEY: 'sk-live-1', region: 'eu-west' } } })
    writeScenario(
      r,
      'api/supplied-request.yaml',
      apiScenario({
        id: 'supplied.request',
        binds: specBinds('cli/version'),
        steps: [
          // Request side: the token is in the path, the expectation names the
          // REGISTERED value — so a token that stayed literal cannot pass by
          // matching itself on both sides.
          {
            request: {
              method: 'GET',
              path: '/echo/thing?region=${supplied:vendor-account.region}',
            },
            expect: { status: 200, json: { 'query.region': { equals: 'eu-west' } } },
          },
          // Expectation side: the literal is on the wire, the token in the matcher.
          {
            request: { method: 'GET', path: '/echo/thing?region=eu-west' },
            expect: {
              status: 200,
              json: { 'query.region': { equals: '${supplied:vendor-account.region}' } },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios.find((x) => x.id === 'supplied.request')!
    // A literal `${supplied:…}` on the wire is the defect this guards.
    expect(s.failure?.actual ?? '').not.toContain('${supplied:')
    expect(s.outcome).toBe('pass')
  })

  it('exports a registered env instance into the booted server’s environment', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCatalog(r, [ACCOUNT])
    writeLocal(r, { 'vendor-account': { env: { TC_SUPPLIED_KEY: 'sk-live-2', region: 'eu-west' } } })
    writeScenario(
      r,
      'api/supplied-env.yaml',
      {
        ...apiScenario({
          id: 'supplied.env',
          binds: specBinds('cli/whoami'),
          steps: [
            {
              request: { method: 'GET', path: '/boot' },
              expect: { status: 200, json: { 'env.TC_SUPPLIED_KEY': { equals: 'sk-live-2' } } },
            },
          ],
        }),
        needs: ['vendor-account'],
      },
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios.find((x) => x.id === 'supplied.env')!
    expect(s.outcome).toBe('pass')
  })

  it('resolves a supplied token in setup.env, which the server then reads', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCatalog(r, [ACCOUNT])
    writeLocal(r, { 'vendor-account': { env: { TC_SUPPLIED_KEY: 'sk-live-3', region: 'eu-west' } } })
    writeScenario(
      r,
      'api/supplied-setup.yaml',
      apiScenario({
        id: 'supplied.setup',
        binds: specBinds('cli/boom'),
        setup: { env: { TC_REGION: '${supplied:vendor-account.region}' } },
        steps: [
          {
            request: { method: 'GET', path: '/boot' },
            expect: { status: 200, json: { 'env.TC_REGION': { equals: 'eu-west' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios.find((x) => x.id === 'supplied.setup')!
    expect(s.failure?.actual ?? '').not.toContain('${supplied:')
    expect(s.outcome).toBe('pass')
  })
})
