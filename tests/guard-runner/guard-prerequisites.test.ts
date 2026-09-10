import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  resolvePrerequisites,
  scenarioPrerequisiteBlock,
  scenarioAccountEnvironment,
  externalsInjectEnv,
  externalsLocalPath,
  dependenciesPath,
  dependenciesLocalPath,
  runGuard,
} from '@truecourse/guard-runner'
import type { GuardScenario } from '@truecourse/shared'
import { makeTempRepo, rmrf, specBinds, writeApiRecipe, writeScenario } from './helpers.js'
const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo() {
  const r = makeTempRepo()
  repos.push(r)
  return r
}
function write(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data))
}
const declared = {
  currencybeacon: {
    baseUrlEnv: 'CURRENCYBEACON_BASE_URL',
    baseUrl: 'http://127.0.0.1:9999',
    env: { CURRENCYBEACON_API_KEY: {} },
  },
}
const scenario: GuardScenario = {
  id: 'convert',
  title: 'convert',
  binds: [],
  prerequisites: [{ dependency: 'currencybeacon', mode: 'provided' }],
  steps: [],
}
describe('one account resolution for gate and injection', () => {
  it('preserves service-only URL overlays while catalog fields retain ownership', () => {
    const r = repo()
    const catalog = { dependencies: [{
      name: 'account', class: 'supplied', summary: 'Provider', services: ['currencybeacon'], needs: [],
      registration: { kind: 'env', vars: [{ name: 'CURRENCYBEACON_API_KEY', description: 'Key', secret: true }] },
    }] }
    write(dependenciesPath(r), catalog)
    write(dependenciesLocalPath(r), { account: { env: { CURRENCYBEACON_API_KEY: 'catalog-key' } } })
    write(externalsLocalPath(r), { currencybeacon: {
      baseUrl: 'https://sandbox.test', endpoints: { SECOND_URL: 'https://secondary-sandbox.test' },
      env: { CURRENCYBEACON_API_KEY: 'ignored-key' },
    } })
    const declarations = { currencybeacon: { ...declared.currencybeacon, endpoints: { SECOND_URL: 'https://production.test' } } }
    expect(externalsInjectEnv(resolvePrerequisites(r, declarations).externals)).toMatchObject({
      CURRENCYBEACON_BASE_URL: 'https://sandbox.test', SECOND_URL: 'https://secondary-sandbox.test',
      CURRENCYBEACON_API_KEY: 'catalog-key',
    })
    catalog.dependencies[0].registration.vars.push(
      { name: 'CURRENCYBEACON_BASE_URL', description: 'URL', secret: false },
      { name: 'SECOND_URL', description: 'Secondary URL', secret: false },
    )
    write(dependenciesPath(r), catalog)
    write(dependenciesLocalPath(r), { account: { env: {
      CURRENCYBEACON_API_KEY: 'catalog-key', CURRENCYBEACON_BASE_URL: 'https://catalog.test', SECOND_URL: 'https://catalog-secondary.test',
    } } })
    expect(externalsInjectEnv(resolvePrerequisites(r, declarations).externals)).toMatchObject({
      CURRENCYBEACON_BASE_URL: 'https://catalog.test', SECOND_URL: 'https://catalog-secondary.test',
    })
  })
  it('selects catalog-only account env and secrets by canonical name or alias', () => {
    const r = repo()
    write(dependenciesPath(r), { dependencies: ['account', 'unrelated'].map(name => ({
      name, class: 'supplied', summary: name, services: [name + '-service'], needs: [],
      registration: { kind: 'env', vars: [{ name: name.toUpperCase() + '_KEY', description: 'Key', secret: true }] },
    })) })
    write(dependenciesLocalPath(r), { account: { env: { ACCOUNT_KEY: 'selected-key' } }, unrelated: { env: { UNRELATED_KEY: 'other-key' } } })
    const resolved = resolvePrerequisites(r)
    for (const name of ['account', 'account-service']) {
      const account = scenarioAccountEnvironment({ ...scenario, prerequisites: [{ dependency: name, mode: 'provided' }] }, resolved)
      expect(account.env).toEqual({ ACCOUNT_KEY: 'selected-key' })
      expect([...account.secrets]).toEqual([['account.ACCOUNT_KEY', 'selected-key']])
    }
  })
  it('blocks external-only missing and incomplete accounts and injects only supplied values', () => {
    const r = repo()
    expect(scenarioPrerequisiteBlock(scenario, resolvePrerequisites(r, declared))).toMatchObject({
      dependency: 'currencybeacon',
      registerIn: externalsLocalPath(r),
    })
    write(externalsLocalPath(r), { currencybeacon: { baseUrl: 'http://127.0.0.1:9998' } })
    expect(resolvePrerequisites(r, declared).targets[0].state).toBe('incomplete')
    write(externalsLocalPath(r), { currencybeacon: { env: { CURRENCYBEACON_API_KEY: 'test-secret' } } })
    const resolved = resolvePrerequisites(r, declared)
    expect(scenarioPrerequisiteBlock(scenario, resolved)).toBeNull()
    expect(externalsInjectEnv(resolved.externals)).toEqual({
      CURRENCYBEACON_BASE_URL: declared.currencybeacon.baseUrl,
      CURRENCYBEACON_API_KEY: 'test-secret',
    })
    expect(JSON.stringify(resolved.targets)).not.toContain('test-secret')
  })
  it('uses catalog associations for both availability and account values', () => {
    const r = repo()
    write(dependenciesPath(r), {
      dependencies: [
        {
          name: 'currency-account',
          class: 'supplied',
          summary: 'Currency provider',
          services: ['currencybeacon'],
          registration: { kind: 'env', vars: [{ name: 'CURRENCYBEACON_API_KEY', description: 'Provider key' }] },
          needs: [],
        },
      ],
    })
    write(externalsLocalPath(r), { currencybeacon: { env: { CURRENCYBEACON_API_KEY: 'ignored-external' } } })
    expect(scenarioPrerequisiteBlock(scenario, resolvePrerequisites(r, declared))?.dependency).toBe('currency-account')
    write(dependenciesLocalPath(r), { 'currency-account': { env: { CURRENCYBEACON_API_KEY: 'catalog-key' } } })
    const resolved = resolvePrerequisites(r, declared)
    expect(scenarioPrerequisiteBlock(scenario, resolved)).toBeNull()
    expect(externalsInjectEnv(resolved.externals).CURRENCYBEACON_API_KEY).toBe('catalog-key')
    expect(resolved.targets[0].registerIn).toBe(dependenciesLocalPath(r))
  })
  it('keeps an absent-key case runnable after account provision and rejects origin substitution', () => {
    const r = repo()
    write(externalsLocalPath(r), { currencybeacon: { env: { CURRENCYBEACON_API_KEY: 'provided' } } })
    const resolved = resolvePrerequisites(r, declared)
    expect(
      scenarioPrerequisiteBlock(
        {
          ...scenario,
          prerequisites: [{ dependency: 'currencybeacon', mode: 'absent' }],
          setup: { env: { CURRENCYBEACON_API_KEY: '' } },
        },
        resolved,
      ),
    ).toBeNull()
    expect(
      scenarioPrerequisiteBlock(
        { ...scenario, setup: { env: { CURRENCYBEACON_BASE_URL: '${HTTP_STUB:fake}' } } },
        resolved,
      )?.detail,
    ).toContain('must not override')
  })
  it('injects registered secondary endpoints while retaining unregistered declaration defaults', () => {
    const r = repo()
    write(dependenciesPath(r), { dependencies: [{
      name: 'account', class: 'supplied', summary: 'Provider account', services: ['currencybeacon'], needs: [],
      registration: { kind: 'env', vars: [
        { name: 'CURRENCYBEACON_API_KEY', description: 'Key', secret: true },
        { name: 'SECOND_URL', description: 'Secondary sandbox URL', secret: false },
      ] },
    }] })
    write(dependenciesLocalPath(r), { account: { env: {
      CURRENCYBEACON_API_KEY: 'fixture-key', SECOND_URL: 'http://sandbox.test',
    } } })
    const resolved = resolvePrerequisites(r, { currencybeacon: {
      ...declared.currencybeacon,
      endpoints: { SECOND_URL: 'http://production.test', OTHER_URL: 'http://other.test' },
    } })
    expect(resolved.targets[0].state).toBe('provided')
    expect(externalsInjectEnv(resolved.externals)).toMatchObject({
      SECOND_URL: 'http://sandbox.test', OTHER_URL: 'http://other.test',
    })
    expect(resolved.externals[0].endpoints).toContainEqual({ envVar: 'SECOND_URL', url: 'http://sandbox.test' })
  })
  it.each(['command', 'boot'] as const)('requires scenario-wide absence and rejects a temporary %s credential override', (kind) => {
    const r = repo()
    write(externalsLocalPath(r), { currencybeacon: { env: { CURRENCYBEACON_API_KEY: 'provided' } } })
    const resolved = resolvePrerequisites(r, declared)
    const step = (value: string): GuardScenario['steps'][number] => kind === 'command'
      ? { run: ['--version'], env: { CURRENCYBEACON_API_KEY: value } }
      : { boot: { env: { CURRENCYBEACON_API_KEY: value } } }
    const absent: GuardScenario = {
      ...scenario, prerequisites: [{ dependency: 'currencybeacon', mode: 'absent' }],
      steps: [step(''), { run: ['--version'] }],
    }
    expect(scenarioPrerequisiteBlock(absent, resolved)?.detail).toContain('setup.env')
    const cleared = { ...absent, setup: { env: { CURRENCYBEACON_API_KEY: '' } } }
    expect(scenarioPrerequisiteBlock(cleared, resolved)).toBeNull()
    expect(scenarioPrerequisiteBlock({ ...cleared, steps: [step('restored'), step('')] }, resolved)?.detail)
      .toContain('setup.env')
    expect(scenarioPrerequisiteBlock({ ...scenario, steps: [step(''), step('provided')] }, resolved)?.detail)
      .toContain('must not override')
  })
  it('blocks a step-only key clearing before execution and runs after scenario-wide clearing', async () => {
    const r = repo()
    const program = path.join(r, 'check-key.cjs')
    fs.writeFileSync(program, 'console.log(process.env.CURRENCYBEACON_API_KEY ? "KEY_PRESENT" : "KEY_ABSENT")')
    writeApiRecipe(r, { entry: ['node', program], serve: ['node', 'unused.js'], externals: declared })
    write(externalsLocalPath(r), { currencybeacon: { env: { CURRENCYBEACON_API_KEY: 'fixture-key' } } })
    const absent: GuardScenario = {
      id: 'absent', title: 'Absent account', binds: specBinds('cli/version'),
      prerequisites: [{ dependency: 'currencybeacon', mode: 'absent' }],
      steps: [
        { run: [], expect: { stdout: { contains: 'KEY_ABSENT' } } },
        { run: [], env: { CURRENCYBEACON_API_KEY: '' }, expect: { stdout: { contains: 'KEY_ABSENT' } } },
      ],
    }
    writeScenario(r, 'absent.yaml', absent)
    const blocked = await runGuard({ repoRoot: r, skipBuild: true })
    expect(blocked.status).toBe('ok')
    if (blocked.status !== 'ok') throw new Error(JSON.stringify(blocked))
    expect(blocked.latest.summary).toMatchObject({ blocked: 1, pass: 0, fail: 0 })
    writeScenario(r, 'absent.yaml', { ...absent, setup: { env: { CURRENCYBEACON_API_KEY: '' } } })
    const cleared = await runGuard({ repoRoot: r, skipBuild: true })
    expect(cleared.status).toBe('ok')
    if (cleared.status !== 'ok') throw new Error(JSON.stringify(cleared))
    expect(cleared.latest.summary).toMatchObject({ blocked: 0, pass: 1, fail: 0 })
  })
})

it('withholds every associated service when one shared account requirement is incomplete', () => {
  const r = repo()
  write(dependenciesPath(r), {
    dependencies: [
      {
        name: 'account',
        class: 'supplied',
        summary: 'Shared account',
        services: ['first', 'second'],
        registration: { kind: 'env', vars: [{ name: 'KEY', description: 'Key', secret: true }] },
        needs: [],
      },
    ],
  })
  write(dependenciesLocalPath(r), { account: { env: { KEY: 'registered' } } })
  const resolved = resolvePrerequisites(r, {
    first: { baseUrlEnv: 'FIRST_URL', baseUrl: 'http://first.test', env: { KEY: {} } },
    second: { baseUrlEnv: 'SECOND_URL', baseUrl: 'http://second.test', env: { MISSING_KEY: {} } },
  })
  expect(resolved.targets[0].state).toBe('incomplete')
  expect(resolved.dependencies.dependencies[0].state).toBe('incomplete')
  expect(resolved.dependencies.dependencies[0].requirements).toEqual(
    expect.arrayContaining([expect.objectContaining({ field: 'MISSING_KEY', resolved: false })]),
  )
  expect(externalsInjectEnv(resolved.externals)).toEqual({})
})
