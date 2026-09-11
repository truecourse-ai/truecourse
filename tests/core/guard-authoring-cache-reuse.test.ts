import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { flowFingerprint, GUARD_REVIEW_POLICY_VERSION, type GuardFlow } from '@truecourse/shared'
import { collectWorkDocs, planGuardWork, type FlowSynthesisArea } from '@truecourse/guard-generator'
import { buildSurfaceCatalogs, matchCacheKey, matchFlow, MATCH_CACHE_NAME, readCachedMatch } from '../../packages/guard-generator/src/match.js'
import { createAuthorCatalog } from '../../packages/guard-generator/src/author-catalog.js'
import { buildAuthorUserPrompt } from '../../packages/guard-generator/src/prompts.js'
import type { FlowWorkerTask } from '../../packages/guard-generator/src/generate.js'
import { createGuardGenerateSessionSeams } from '../../packages/core/src/services/guard-generate/run.js'
import { EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey } from '../../packages/core/src/services/guard-generate/extract.js'
import { FLOWS_SESSION_CACHE_NAME, flowsSessionCacheKey } from '../../packages/core/src/services/guard-generate/flows.js'
import { CachedWorkerEntrySchema, flowWorkerCacheKey, flowWorkerPromptFingerprint } from '../../packages/core/src/services/guard-generate/flow-worker.js'
import { authoringFixture } from '../fixtures/guard-authoring-benchmark/fixture.js'
import { makeTempRepo, rmrf, writeCorpus, writeDoc, writeRecipe } from '../guard-generator/helpers.js'
import { memoryPersistence, stubDriver } from './spec-scan-session-stub.js'

const roots: string[] = []
afterEach(() => { while (roots.length) rmrf(roots.pop()!) })
const DOC = 'docs/tasks.md', ANCHOR = 'tasks/creating-tasks', CLAIM = '`relkit add <title>` creates a task'
function seededRepo() {
  const root = makeTempRepo(); roots.push(root)
  writeRecipe(root); writeCorpus(root, [{ ref: DOC }]); writeDoc(root, DOC, '# Tasks\n\n## Creating tasks\n\n`relkit add <title>` creates a task.\n')
  const doc = collectWorkDocs(root, planGuardWork(root))[0]
  const area: FlowSynthesisArea = { areaId: 'tasks', claims: [{ doc: DOC, anchor: ANCHOR, title: CLAIM, driver: 'cli' }],
    docs: [{ doc: DOC, outline: doc.sections.map(s => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })) }] }
  return { root, doc, area }
}

describe('author-only changes retain upstream cache compatibility', () => {
  it('reads seeded extract and synthesis outcomes with zero upstream driver calls', async () => {
    const { root, doc, area } = seededRepo()
    const extract = { claims: [{ claim: CLAIM, driver: 'cli', sectionAnchor: ANCHOR, reason: 'stdout carries the id',
      verification: { scope: 'configuration', method: 'behavior', observable: 'Task id', cases: [{ id: 'created-id', claim: 'Prints the id', method: 'behavior', requires: ['process'], conditions: [] }] }, needs: [] }], untestable: [] }
    const flows = { flows: [{ title: 'Create task', goal: 'Create task', milestones: [{ order: 1, doc: DOC, anchor: ANCHOR, claimTitle: CLAIM }] }], noFlowClaims: [] }
    const keys = [extractSessionCacheKey(doc), flowsSessionCacheKey(area)]
    await setCacheEntry(root, EXTRACT_SESSION_CACHE_NAME, keys[0], extract)
    await setCacheEntry(root, FLOWS_SESSION_CACHE_NAME, keys[1], flows)
    const f = authoringFixture(); const catalog = createAuthorCatalog(f.interfaces, f.resources)
    buildAuthorUserPrompt({ ...f.context, webSetupCandidates: catalog.candidates([f.own], 'organisation') })
    const calls = vi.fn(() => { throw new Error('Warm upstream cache must never call a provider') })
    const { driver } = stubDriver(calls)
    const acquire = vi.fn(async () => ({ driver, persistence: memoryPersistence().persistence }))
    const seams = createGuardGenerateSessionSeams({ repoRoot: root, driver: acquire })
    expect((await seams.extractSession({ docs: [doc] })).summary).toMatchObject({ ran: 0, fromCache: 1 })
    expect((await seams.flowsAreaSession({ areas: [area], docs: [doc] })).summary).toMatchObject({ ran: 0, fromCache: 1 })
    expect(calls).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
    expect([extractSessionCacheKey(doc), flowsSessionCacheKey(area)]).toEqual(keys)
  })
  it('classifies valid, invalid, missing and deterministic no-call matching pairs individually', async () => {
    const root = makeTempRepo(); roots.push(root)
    const fixture = authoringFixture(); const catalog = buildSurfaceCatalogs([fixture.own]).get('web')!
    const makeFlow = (id: string, implementation = false): GuardFlow => {
      const milestones = [{ order: 1, doc: 'synthetic.md', anchor: id, claimTitle: 'Show dialog', proofDrivers: ['web' as const],
        ...(implementation ? { verification: { method: 'implementation' as const, observable: 'Inspect source algorithm' } } : {}) }]
      return { id, title: id, goal: 'Show dialog', fingerprint: flowFingerprint(milestones), milestones,
        bindings: [{ doc: 'synthetic.md', anchor: id, fingerprint: 'sha256:doc' }], composedOf: [], synthesisInputsHash: 'same' }
    }
    const valid = makeFlow('valid'), invalid = makeFlow('invalid'), missing = makeFlow('missing'), skipped = makeFlow('skipped', true)
    const reply = { plan: [{ interfaceId: fixture.own.id, milestone: 1 }], gaps: [] }
    const originalKey = matchCacheKey(valid, catalog)
    await setCacheEntry(root, MATCH_CACHE_NAME, originalKey, reply)
    await setCacheEntry(root, MATCH_CACHE_NAME, matchCacheKey(invalid, catalog), { plan: [{ interfaceId: 'invented', milestone: 1 }] })
    createAuthorCatalog(fixture.interfaces, fixture.resources).get({ ids: [fixture.late.id] })
    expect(matchCacheKey(valid, catalog)).toBe(originalKey)
    const calls = vi.fn(async () => reply)
    expect(await readCachedMatch(root, valid, catalog)).not.toBeNull()
    expect(await readCachedMatch(root, invalid, catalog)).toBeNull()
    expect(await readCachedMatch(root, missing, catalog)).toBeNull()
    expect(await matchFlow(root, valid, catalog, calls)).toMatchObject({ calls: 0 })
    expect(await matchFlow(root, skipped, catalog, calls)).toMatchObject({ calls: 0, kind: 'gap' })
    expect(calls).not.toHaveBeenCalled()
    expect(await matchFlow(root, invalid, catalog, calls)).toMatchObject({ calls: 1 })
    expect(await matchFlow(root, missing, catalog, calls)).toMatchObject({ calls: 1 })
    expect(calls).toHaveBeenCalledTimes(2)
  })
  it('web author contract misses preserve old rows; review migration is independent of CLI/API input keys', async () => {
    const root = makeTempRepo(); roots.push(root)
    const f = authoringFixture()
    const before = createAuthorCatalog(f.interfaces, f.resources)
    const updatedResources = structuredClone(f.resources)
    updatedResources.web[1].readables = { markers: [{ id: 'permission-marker', text: 'Manager access required' }] }
    const after = createAuthorCatalog(f.interfaces, updatedResources)
    expect(before.fingerprint).not.toBe(after.fingerprint)
    const task = (surface: 'cli' | 'api' | 'web', catalog = before): FlowWorkerTask => ({ surface, catalog,
      cacheMaterial: { flowFingerprint: 'same-flow', sectionKeys: ['same-section'], recipeFingerprint: 'same-recipe',
        interfaceFingerprints: ['matched-interface', ...(surface === 'web' ? [catalog.fingerprint] : [])], mode: 'scratch', priorShas: [] } } as unknown as FlowWorkerTask)
    const oldWeb = flowWorkerCacheKey(task('web', before)), newWeb = flowWorkerCacheKey(task('web', after))
    await setCacheEntry(root, 'guard/generate', oldWeb, { retained: true })
    expect(oldWeb).not.toBe(newWeb)
    expect(await getCacheEntry(root, 'guard/generate', newWeb)).toBeNull()
    expect(await getCacheEntry(root, 'guard/generate', oldWeb)).toEqual({ retained: true })
    for (const surface of ['cli', 'api'] as const) {
      // Only web consumes the catalog dependency. The actual worker helper
      // cannot accidentally include a catalog supplied on another surface.
      expect(flowWorkerCacheKey(task(surface, after))).toBe(flowWorkerCacheKey(task(surface, before)))
      expect(flowWorkerPromptFingerprint(surface)).not.toBe(flowWorkerPromptFingerprint('web'))
    }
    const cached = { version: GUARD_REVIEW_POLICY_VERSION - 1,
      outcome: { kind: 'settled', scenarioYamlSha: 'sha', expectedReds: [] }, scenarioYaml: 'yaml', reviews: [] }
    expect(CachedWorkerEntrySchema.safeParse(cached).success).toBe(false)
    expect(CachedWorkerEntrySchema.safeParse({ ...cached, version: GUARD_REVIEW_POLICY_VERSION }).success).toBe(true)
  })
})
