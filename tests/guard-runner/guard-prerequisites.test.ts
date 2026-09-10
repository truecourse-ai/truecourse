import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  resolvePrerequisites,
  scenarioPrerequisiteBlock,
  externalsInjectEnv,
  externalsLocalPath,
  dependenciesPath,
  dependenciesLocalPath,
} from '@truecourse/guard-runner'
import type { GuardScenario } from '@truecourse/shared'
import { makeTempRepo, rmrf } from './helpers.js'
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
