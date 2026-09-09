import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer'
import { detectExternalServices } from '../../packages/analyzer/src/external-services'
import { deriveExternalsSkeleton } from '../../packages/guard-generator/src/externals-skeleton'
import { readGuardDependenciesView } from '../../packages/core/src/commands/guard-dependencies'
import { writeGuardExternals } from '../../packages/core/src/commands/guard-externals'
import { computeRecipeFingerprint, loadRecipe, loadResolvedExternals, runGuard, recipePath, externalsLocalPath } from '@truecourse/guard-runner'
import { apiScenario, makeTempRepo, rmrf, specBinds, writeApiRecipe, writeScenario } from '../guard-runner/helpers'

const repos: string[] = []
const close: (() => Promise<void>)[] = []
afterEach(async () => {
  while (close.length) await close.pop()!()
  while (repos.length) rmrf(repos.pop()!)
})

describe('detected credentials through dependency setup and the real runner', () => {
  it('requires the detected key, stores it locally, then makes an authenticated request from the app', async () => {
    const repo = makeTempRepo(); repos.push(repo)
    const fixture = path.resolve('tests/fixtures/guard-credential-detection/server.js')
    const analysis = await analyzeFile(fixture)
    const services = detectExternalServices([analysis!])
    expect(services[0].credentialEnvs?.map(c => c.envVar)).toEqual(['CURRENCYBEACON_API_KEY'])
    writeApiRecipe(repo, {serve: ['node', fixture]})
    const recipe = loadRecipe(repo, recipePath(repo))!.recipe
    const {declare} = deriveExternalsSkeleton(recipe, services)
    fs.writeFileSync(recipePath(repo), JSON.stringify({...recipe, api: {...recipe.api, externals: declare}}))
    const read = () => readGuardDependenciesView(repo, {env: {}}).dependencies.find(d => d.name === 'currencybeacon')!
    expect(read()).toMatchObject({state: 'unprovided', fields: [
      {field: 'CURRENCYBEACON_BASE_URL', resolved: false, secret: false},
      {field: 'CURRENCYBEACON_API_KEY', resolved: false, secret: true},
    ]})

    const requests: string[] = []
    let authenticated = 0
    const upstream = http.createServer((req, res) => {
      requests.push(req.url!)
      const authorized = req.headers.authorization === 'Bearer integration-test-secret'
      if (authorized) authenticated++
      res.writeHead(authorized ? 200 : 401, {'Content-Type': 'application/json'})
      res.end(JSON.stringify(authorized ? {rate: 0.9} : {error: 'Missing or invalid key'}))
    })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    close.push(() => new Promise<void>(resolve => upstream.close(() => resolve())))
    const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
    writeGuardExternals(repo, {externals: {currencybeacon: {baseUrlEnv: 'CURRENCYBEACON_BASE_URL', baseUrl, baseUrlTarget: 'local'}}})
    expect(read().state).toBe('incomplete')
    writeScenario(repo, 'api/convert.yaml', apiScenario({id: 'convert', binds: specBinds('cli/version'), setup: {externals: {currencybeacon: {calls: 1}}}, steps: [
      {request: {method: 'GET', path: '/convert'}, expect: {status: 200, json: {convertedAmountCents: {equals: 2250}, amountCents: {equals: 2500}}}},
    ]}))
    writeScenario(repo, 'api/health.yaml', apiScenario({id: 'independent', binds: specBinds('cli/version'), steps: [
      {request: {method: 'GET', path: '/health'}, expect: {status: 200}},
    ]}))
    const incomplete = await runGuard({repoRoot: repo, skipBuild: true})
    expect(incomplete.status).toBe('ok')
    if (incomplete.status === 'ok') expect(incomplete.latest.summary).toMatchObject({pass: 1, error: 1})
    expect(JSON.stringify(incomplete)).toContain('CURRENCYBEACON_API_KEY')
    expect(requests).toEqual([])
    const fingerprint = computeRecipeFingerprint(repo)
    writeGuardExternals(repo, {externals: {currencybeacon: {baseUrlEnv: 'CURRENCYBEACON_BASE_URL', env: {CURRENCYBEACON_API_KEY: {value: 'integration-test-secret'}}}}})
    expect(read().state).toBe('provided')
    expect(JSON.stringify(read())).not.toContain('integration-test-secret')
    expect(fs.readFileSync(recipePath(repo), 'utf8')).not.toContain('integration-test-secret')
    expect(fs.readFileSync(externalsLocalPath(repo), 'utf8')).toContain('integration-test-secret')
    expect(computeRecipeFingerprint(repo)).toBe(fingerprint)
    expect(loadResolvedExternals(repo, loadRecipe(repo, recipePath(repo))!.recipe.api!.externals, {})[0].inject.CURRENCYBEACON_API_KEY).toBe('integration-test-secret')
    const result = await runGuard({repoRoot: repo, skipBuild: true})
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.latest.summary.pass).toBe(2)
    expect(authenticated).toBe(1)
    expect(requests).toEqual(['/v1/latest'])
    expect(JSON.stringify(result)).not.toContain('integration-test-secret')

    writeGuardExternals(repo, {externals: {currencybeacon: {baseUrlEnv: 'CURRENCYBEACON_BASE_URL', env: {CURRENCYBEACON_API_KEY: {value: 'invalid-test-secret'}}}}})
    const rejected = await runGuard({repoRoot: repo, skipBuild: true})
    expect(rejected.status).toBe('ok')
    if (rejected.status === 'ok') expect(rejected.latest.summary.fail).toBe(1)
    expect(authenticated).toBe(1)
  }, 30_000)
})
