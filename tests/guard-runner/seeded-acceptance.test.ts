import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGuard, scenarioSeedNamespace, type ScenarioArtifact } from '@truecourse/guard-runner'
import { apiScenario, makeTempRepo, rmrf, writeSpecDoc } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const SERVER = `
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const file = process.env.ACCEPTANCE_STATE_PATH
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return }
  const url = new URL(req.url, 'http://guard.local')
  if (url.pathname !== '/snapshot') { res.writeHead(404); res.end(); return }
  const namespace = url.searchParams.get('namespace')
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const record = state[namespace]
  const authorized = req.headers.authorization === 'Bearer ' + namespace + '-verification'
  res.writeHead(record ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(record ? { ...record, authorized } : { missing: true }))
})
server.listen(Number(process.env.PORT), '127.0.0.1')
`

const SIDECAR = `
import fs from 'node:fs'
import path from 'node:path'
const namespace = process.env.GUARD_SEED_NAMESPACE
const file = process.env.ACCEPTANCE_STATE_PATH
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
state[namespace] = {
  lifecycle: { entity: 'booking', status: 'cancelled' },
  aggregate: { organization: 'acme', team: 'support', member: 'owner' },
  recurring: { count: 3, cadence: 'weekly' },
  pastBooking: { status: 'completed' },
  verification: { issued: true }
}
const staged = file + '.tmp'
fs.writeFileSync(staged, JSON.stringify(state, null, 2))
fs.renameSync(staged, file)
fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({
  fixtures: { world: { namespace } },
  credentials: { verifier: { value: 'Bearer ' + namespace + '-verification' } }
}))
`

function artifact(id: string): ScenarioArtifact {
  const scenario = apiScenario({
    id,
    setup: {
      seed: {
        provides: {
          fixtures: { world: ['namespace'] },
          credentials: { verifier: { header: 'Authorization' } },
        },
      },
    },
    steps: [
      {
        request: {
          method: 'GET',
          path: '/snapshot?namespace={{fixture:world.namespace}}',
          headers: { Authorization: '{{cred:verifier}}' },
        },
        expect: {
          status: 200,
          json: {
            'lifecycle.entity': { equals: 'booking' },
            'lifecycle.status': { equals: 'cancelled' },
            'aggregate.organization': { equals: 'acme' },
            'aggregate.team': { equals: 'support' },
            'aggregate.member': { equals: 'owner' },
            'recurring.count': { equals: 3 },
            'recurring.cadence': { equals: 'weekly' },
            'pastBooking.status': { equals: 'completed' },
            'verification.issued': { equals: true },
            authorized: { equals: true },
          },
        },
      },
    ],
  })
  const yamlPath = `.truecourse/scenarios/acceptance/${id}.yaml`
  return {
    scenario,
    source: { path: yamlPath, content: JSON.stringify(scenario) },
    companions: { [yamlPath.replace(/\.yaml$/, '.seed.mjs')]: SIDECAR },
  }
}

describe('seeded acceptance — reusable datastore convergence', () => {
  it('repairs exact owned state without accumulation and preserves sibling namespaces', async () => {
    const repoRoot = makeTempRepo()
    repos.push(repoRoot)
    writeSpecDoc(repoRoot)
    fs.writeFileSync(path.join(repoRoot, 'server.mjs'), SERVER)
    const recipe = {
      build: 'true',
      api: {
        serve: ['node', path.join(repoRoot, 'server.mjs')],
        healthPath: '/health',
        env: { ACCEPTANCE_STATE_PATH: path.join(repoRoot, 'acceptance-state.json') },
      },
    }
    const artifacts = [artifact('cal-lifecycle'), artifact('cal-recurring')]

    const first = await runGuard({ repoRoot, recipe, artifacts, skipBuild: true, persist: false })
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return
    expect(first.latest.scenarios).toMatchObject([{ outcome: 'pass' }, { outcome: 'pass' }])

    const statePath = path.join(repoRoot, 'acceptance-state.json')
    const initial = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>
    const namespaces = Object.keys(initial).sort()
    expect(namespaces).toHaveLength(2)
    expect(namespaces[0]).not.toBe(namespaces[1])
    const targetNamespace = scenarioSeedNamespace(repoRoot, artifacts[0].scenario.id)
    const siblingNamespace = namespaces.find((namespace) => namespace !== targetNamespace)!
    const siblingBefore = JSON.stringify(initial[siblingNamespace])

    const mutated = structuredClone(initial) as Record<string, any>
    mutated[targetNamespace].lifecycle.status = 'active'
    mutated[targetNamespace].recurring.count = 99
    mutated[targetNamespace].staleOwnedRow = { id: 'must-disappear' }
    fs.writeFileSync(statePath, JSON.stringify(mutated, null, 2))

    const second = await runGuard({ repoRoot, recipe, artifacts: [artifacts[0]], skipBuild: true, persist: false })
    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return
    expect(second.latest.scenarios[0].outcome).toBe('pass')

    const repaired = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, any>
    expect(repaired[targetNamespace]).toEqual(initial[targetNamespace])
    expect(repaired[targetNamespace]).not.toHaveProperty('staleOwnedRow')
    expect(JSON.stringify(repaired[siblingNamespace])).toBe(siblingBefore)
    expect(JSON.stringify(repaired)).not.toContain('-verification')
  })
})
