import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, runFailureMessage, buildCredentialRedactor, externalsLocalPath } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeApiRecipe, writeScenario, apiScenario, specBinds } from './helpers.js'

/**
 * External API accounts through `runGuard`: what a PROVIDED account puts
 * into the SERVER env, who beats whom, the hard stop on a half-configured one, and
 * the redaction of its secret values.
 *
 * The fixture server's `GET /boot` echoes every `TC_*` env var it was started with,
 * so the assertions are on the app's OWN view of its environment — the only honest
 * proof that the injection reached the process under test.
 */

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function writeLocal(r: string, local: unknown): void {
  const target = externalsLocalPath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(local, null, 2))
}

/**
 * A declaration the user half-answered: a base URL, and a key whose host env var is
 * unset — `incomplete`, the state the runner refuses (see `resolveExternal`).
 */
const HALF_CONFIGURED = {
  baseUrlEnv: 'TC_UPSTREAM_BASE',
  baseUrl: 'https://sandbox.test',
  env: { TC_EXT_KEY: { valueFromEnv: 'TC_HOST_KEY_THAT_IS_UNSET' } },
}

/** One api scenario asserting what `GET /boot` reports for `TC_UPSTREAM_BASE`. */
function bootEnvScenario(id: string, expectedBase: string, setupEnv?: Record<string, string>): void {
  return apiScenario({
    id,
    binds: specBinds('cli/version'),
    ...(setupEnv ? { setup: { env: setupEnv } } : {}),
    steps: [
      {
        request: { method: 'GET', path: '/boot' },
        expect: { status: 200, json: { 'env.TC_UPSTREAM_BASE': { equals: expectedBase } } },
      },
    ],
  }) as never
}

describe('runGuard — provided external accounts', () => {
  it('injects the base URL + key of a PROVIDED external into the server env', async () => {
    const r = repo()
    writeApiRecipe(r, {
      externals: {
        'open-meteo': {
          baseUrlEnv: 'TC_UPSTREAM_BASE',
          baseUrl: 'https://sandbox.open-meteo.test',
          mode: 'sandbox',
          env: { TC_EXT_KEY: {} },
        },
      },
    })
    writeLocal(r, { 'open-meteo': { env: { TC_EXT_KEY: 'ext-secret-value' } } })
    writeScenario(
      r,
      'api/boot.yaml',
      apiScenario({
        id: 'boot-env',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/boot' },
            expect: {
              status: 200,
              json: {
                // A PROVIDED account is reached THROUGH the runner's proxy, so what
                // the app reads is a loopback origin — the account itself is the
                // proxy's upstream (see externals-proxy-run.test.ts).
                'env.TC_UPSTREAM_BASE': { matches: '^http://127\\.0\\.0\\.1:\\d+$' },
                'env.TC_EXT_KEY': { equals: 'ext-secret-value' },
              },
            },
          },
        ],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary.pass).toBe(1)
  })

  it('a PROVIDED external beats api.env; a scenario setup.env still beats the external', async () => {
    const r = repo()
    writeApiRecipe(r, {
      apiEnv: { TC_UPSTREAM_BASE: 'https://from-api-env.test' },
      externals: {
        'open-meteo': { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: 'https://from-external.test' },
      },
    })
    // The provided account beats `api.env` — but the app is pointed at the PROXY in
    // front of it, so the observable claim is "a loopback origin, not the api.env
    // value" (which upstream that proxy forwards to is asserted in
    // externals-proxy-run.test.ts, against a real service).
    writeScenario(
      r,
      'api/a.yaml',
      apiScenario({
        id: 'external-beats-api-env',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/boot' },
            expect: {
              status: 200,
              json: { 'env.TC_UPSTREAM_BASE': { matches: '^http://127\\.0\\.0\\.1:\\d+$' } },
            },
          },
        ],
      }),
    )
    // A scenario that sets the variable itself keeps winning, verbatim — and that
    // variable is then not proxied at all.
    writeScenario(
      r,
      'api/b.yaml',
      bootEnvScenario('setup-beats-external', 'https://from-setup.test', {
        TC_UPSTREAM_BASE: 'https://from-setup.test',
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ pass: 2, fail: 0, error: 0 })
  })

  it('an UNPROVIDED external injects nothing — the api.env default survives', async () => {
    const r = repo()
    writeApiRecipe(r, {
      apiEnv: { TC_UPSTREAM_BASE: 'https://from-api-env.test' },
      externals: { 'open-meteo': { baseUrlEnv: 'TC_UPSTREAM_BASE' } },
    })
    writeScenario(r, 'api/a.yaml', bootEnvScenario('unprovided', 'https://from-api-env.test'))
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary.pass).toBe(1)
  })

  it('a half-configured external leaves scenarios that do NOT drive it alone', async () => {
    const r = repo()
    writeApiRecipe(r, {
      apiEnv: { TC_UPSTREAM_BASE: 'https://from-api-env.test' },
      externals: { 'open-meteo': HALF_CONFIGURED },
    })
    writeScenario(r, 'api/a.yaml', bootEnvScenario('indifferent-a', 'https://from-api-env.test'))
    writeScenario(r, 'api/b.yaml', bootEnvScenario('indifferent-b', 'https://from-api-env.test'))
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    // Both ran, AND the app's own view of its env proves why this is safe: an
    // `incomplete` service injects nothing, so the boot is byte-identical to the
    // UNPROVIDED case above — the `api.env` default survives, no half-account leaks in.
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 2, fail: 0, error: 0 })
  })

  it('only the scenario that DRIVES the half-configured service fails; siblings run', async () => {
    const r = repo()
    writeApiRecipe(r, {
      apiEnv: { TC_UPSTREAM_BASE: 'https://from-api-env.test' },
      externals: { 'open-meteo': HALF_CONFIGURED },
    })
    writeScenario(
      r,
      'api/drives.yaml',
      apiScenario({
        id: 'drives-the-service',
        binds: specBinds('cli/version'),
        // `setup.externals` is the ONE place a scenario says it is driving the live
        // account — so this scenario, and only this one, is refused.
        setup: { externals: { 'open-meteo': { calls: 1 } } },
        steps: [{ request: { method: 'GET', path: '/boot' }, expect: { status: 200 } }],
      }),
    )
    writeScenario(r, 'api/sibling.yaml', bootEnvScenario('sibling', 'https://from-api-env.test'))
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 1, error: 1 })
    const blocked = res.latest.scenarios.find((s) => s.id === 'drives-the-service')!
    expect(blocked.outcome).toBe('error')
    expect(blocked.failure?.expected).toContain('open-meteo')
    expect(blocked.failure?.actual).toContain('TC_HOST_KEY_THAT_IS_UNSET')
    expect(res.latest.scenarios.find((s) => s.id === 'sibling')?.outcome).toBe('pass')
  })

  it('stops the whole run as missing-external-env when EVERY runnable scenario drives it', async () => {
    const r = repo()
    writeApiRecipe(r, { externals: { 'open-meteo': HALF_CONFIGURED } })
    writeScenario(
      r,
      'api/a.yaml',
      apiScenario({
        id: 'never-runs',
        binds: specBinds('cli/version'),
        setup: { externals: { 'open-meteo': { calls: 1 } } },
        steps: [{ request: { method: 'GET', path: '/boot' }, expect: { status: 200 } }],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('missing-external-env')
    if (res.status !== 'missing-external-env') return
    expect(res.message).toContain('open-meteo')
    expect(res.message).toContain('TC_HOST_KEY_THAT_IS_UNSET')
    expect(runFailureMessage(res)).toBe(res.message)
  })

  it('a broken externals.local.json is an invalid-recipe stop, never a silent empty overlay', async () => {
    const r = repo()
    writeApiRecipe(r, {
      externals: { 'open-meteo': { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: 'https://s.test' } },
    })
    fs.writeFileSync(externalsLocalPath(r), '{ broken')
    writeScenario(r, 'api/a.yaml', bootEnvScenario('never-runs', 'https://s.test'))
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('invalid-recipe')
    if (res.status !== 'invalid-recipe') return
    expect(res.message).toContain('externals.local.json')
  })

  it('masks a provided external secret out of failure output and evidence', async () => {
    const r = repo()
    const secret = 'ext-super-secret-value'
    writeApiRecipe(r, {
      externals: {
        'open-meteo': {
          baseUrlEnv: 'TC_UPSTREAM_BASE',
          baseUrl: 'https://sandbox.test',
          env: { TC_EXT_KEY: {} },
        },
      },
    })
    writeLocal(r, { 'open-meteo': { env: { TC_EXT_KEY: secret } } })
    // `/boot` echoes the TC_* env — including the injected key — so a FAILING
    // expectation drags the secret into the failure excerpt and the transcript.
    writeScenario(
      r,
      'api/leak.yaml',
      apiScenario({
        id: 'leak',
        binds: specBinds('cli/version'),
        steps: [{ request: { method: 'GET', path: '/boot' }, expect: { status: 404 } }],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios[0]
    expect(result.outcome).toBe('fail')
    expect(result.failure?.stdout).toContain('«external:open-meteo.TC_EXT_KEY»')
    expect(JSON.stringify(res.latest)).not.toContain(secret)
    const evidence = fs.readFileSync(
      path.join(r, result.evidencePath!, 'transcript.txt'),
      'utf-8',
    )
    expect(evidence).not.toContain(secret)
  })
})

describe('buildCredentialRedactor — external secrets', () => {
  it('masks an external value as «external:<service>.<VAR>», beside credentials', () => {
    const redact = buildCredentialRedactor(
      new Map([['api-key', 'cred-value']]),
      new Map([['open-meteo.GEO_KEY', 'ext-value']]),
    )
    expect(redact('a=cred-value b=ext-value')).toBe('a=«cred:api-key» b=«external:open-meteo.GEO_KEY»')
  })
})
