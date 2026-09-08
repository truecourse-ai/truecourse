import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { GuardManifestSchema, GuardFlowsFileSchema, interfaceFingerprint, type Interface } from '@truecourse/shared'
import {
  extractSessionBy, flowWorkerSessionOf, interfacesOf, makeTempRepo, matchAll,
  rmrf, runGenerate, writeCorpus, writeDoc, writeRecipe, FIXTURE_WEB_SERVER,
} from './helpers.js'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })
const shape = { type: 'web' as const, entry: { command: ['/expenses'] }, steps: [{ kind: 'navigate' as const, route: '/expenses' }] }
const web: Interface = { ...shape, id: 'web/expenses', title: 'Expenses', fingerprint: interfaceFingerprint(shape) }
function seed() {
  const repo = makeTempRepo(); repos.push(repo)
  writeRecipe(repo, { web: { serve: ['node', FIXTURE_WEB_SERVER] }, api: { serve: ['node', FIXTURE_WEB_SERVER] } })
  writeCorpus(repo, [{ ref: 'docs/spec.md' }])
  writeDoc(repo, 'docs/spec.md', '# Expenses\nUsers add an expense and see it in the list.')
  return repo
}

async function generate(repoRoot: string, driver: 'web' | 'api', alternativeDrivers?: ('web' | 'api')[]) {
  const matched: string[] = []
  const workers: string[] = []
  const result = await runGenerate({
    repoRoot,
    interfaces: interfacesOf(repoRoot, web),
    extractSession: extractSessionBy({ expenses: [{ driver, alternativeDrivers }] }),
    matchRunner: matchAll((_id, surface) => matched.push(surface)),
    browserPreflight: async () => ({ ok: true }),
    flowWorkerSession: flowWorkerSessionOf(async (task) => {
      workers.push(task.surface)
      return { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'credentials' }] } }
    }),
  })
  const manifest = GuardManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(repoRoot, '.truecourse/scenarios/manifest.json'), 'utf8')))
  const flows = GuardFlowsFileSchema.parse(JSON.parse(fs.readFileSync(path.join(repoRoot, '.truecourse/scenarios/flows.json'), 'utf8')))
  return { result, manifest, flows, matched, workers }
}

describe('flow driver selection', () => {
  it('selects web for a UI journey despite prepared API/CLI recipes and no API catalog', async () => {
    const { result, manifest, flows, matched, workers } = await generate(seed(), 'web')
    expect(matched).toEqual(['web'])
    expect(workers).toEqual(['web'])
    expect(result.coverageGaps.some((g) => g.surface === 'api' || g.surface === 'cli')).toBe(false)
    expect(manifest.flows[0].gaps.every((g) => g.surface === 'web')).toBe(true)
    expect(flows.flows[0].milestones[0].proofDrivers).toEqual(['web'])
    expect(manifest.flows[0].milestones).toEqual(flows.flows[0].milestones)
  })

  it.each(['HTTP status codes', 'malformed requests', 'headers', 'raw response bodies'])(
    'preserves an API detection gap for %s even with mapped web interfaces', async (promise) => {
      const r = seed()
      writeDoc(r, 'docs/spec.md', `# Expenses\nThe API specifies ${promise}.`)
      const { result, matched, workers } = await generate(r, 'api')
      expect(matched).toEqual([])
      expect(workers).toEqual([])
      expect(result.coverageGaps).toEqual([expect.objectContaining({ surface: 'api', kind: 'no-interface' })])
    },
  )

  it('retains an unavailable genuine alternative as an explicit gap, not an unrelated repository driver', async () => {
    const { result, matched } = await generate(seed(), 'web', ['api'])
    expect(matched).toEqual(['web'])
    expect(result.coverageGaps).toContainEqual(expect.objectContaining({ surface: 'api', kind: 'no-interface' }))
    expect(result.coverageGaps.some((g) => g.surface === 'cli')).toBe(false)
  })
  it('regeneration removes obsolete API gaps but preserves an existing failing API test', async () => {
    const r = seed()
    const before = await generate(r, 'web', ['api'])
    const entry = before.manifest.flows[0]
    entry.scenarios.push({ id: 'expenses.api', drivers: ['api'], status: 'failing', milestoneCoverage: [{ milestone: 1, driver: 'api' }] })
    const file = path.join(r, '.truecourse/scenarios/expenses.api.yaml')
    const scenario = yaml.dump({
      id: 'expenses.api', title: 'Existing API test', flow: { id: entry.flowId, fingerprint: entry.flowFingerprint },
      binds: entry.bindings.map((b) => ({ doc: b.doc, section: b.anchor, fingerprint: b.fingerprint })),
      steps: [{ request: { method: 'GET', path: '/expenses' }, milestone: 1, expect: { status: 201 } }],
    })
    fs.writeFileSync(file, scenario)
    fs.writeFileSync(path.join(r, '.truecourse/scenarios/manifest.json'), JSON.stringify(before.manifest))
    const after = await generate(r, 'web')
    expect(after.manifest.flows[0].gaps.some((g) => g.surface === 'api')).toBe(false)
    expect(after.manifest.flows[0].scenarios).toEqual([{ id: 'expenses.api', drivers: ['api'], status: 'failing' }])
    expect(fs.readFileSync(file, 'utf8')).toBe(scenario)
    expect(after.flows.flows[0].fingerprint).not.toBe(before.flows.flows[0].fingerprint)
  })

})
