import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCacheEntry } from '@truecourse/llm'
import { flowFingerprint, GUARD_REVIEW_POLICY_VERSION, interfaceFingerprint, movedSchemeInputs, type GuardFlow, type Interface } from '@truecourse/shared'
import { buildRouteManifest, loadRecipe, readMergedInterfaceCatalog, recipePath } from '@truecourse/guard-runner'
import {
  buildServerRouteIndex,
  buildWebAuthorCatalog,
  collectWorkDocs,
  planGuardWork,
  readFlowsFile,
  type FlowSynthesisArea,
} from '@truecourse/guard-generator'
import { buildSurfaceCatalogs, matchCacheKey, matchFlow, MATCH_CACHE_NAME, readCachedMatch } from '../../packages/guard-generator/src/match.js'
import { flowGenerationInputComponents, type FlowGenerationInputParts } from '../../packages/guard-generator/src/section-plan.js'
import {
  catalogReadMaterial,
  createAuthorCatalog,
  recordCatalogReads,
  webAuthorKeyMaterial,
} from '../../packages/guard-generator/src/author-catalog.js'
import { buildAuthorUserPrompt } from '../../packages/guard-generator/src/prompts.js'
import type { FlowWorkerTask } from '../../packages/guard-generator/src/generate.js'
import { createGuardGenerateSessionSeams } from '../../packages/core/src/services/guard-generate/run.js'
import { EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey } from '../../packages/core/src/services/guard-generate/extract.js'
import { FLOWS_SESSION_CACHE_NAME, flowsSessionCacheKey } from '../../packages/core/src/services/guard-generate/flows.js'
import { CachedWorkerEntrySchema, flowWorkerCacheKey, flowWorkerPromptFingerprint } from '../../packages/core/src/services/guard-generate/flow-worker.js'
import { authoringFixture } from '../fixtures/guard-authoring-benchmark/fixture.js'
import {
  extractSessionBy,
  FIXTURE_WEB_SERVER,
  flowWorkerSessionOf,
  interfacesOf,
  makeTempRepo,
  rmrf,
  runGenerate,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from '../guard-generator/helpers.js'
import { memoryPersistence, stubDriver } from './spec-scan-session-stub.js'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache.js'

const roots: string[] = []
beforeEach(() => { installMemoryKvCache() })
afterEach(() => { resetKvCacheStore(); while (roots.length) rmrf(roots.pop()!) })
const DOC = 'docs/tasks.md', WEB_DOC = 'docs/app.md', ANCHOR = 'tasks/creating-tasks', CLAIM = '`relkit add <title>` creates a task'
function seededRepo() {
  const root = makeTempRepo(); roots.push(root)
  writeRecipe(root); writeCorpus(root, [{ ref: DOC }]); writeDoc(root, DOC, '# Tasks\n\n## Creating tasks\n\n`relkit add <title>` creates a task.\n')
  const doc = collectWorkDocs(root, planGuardWork(root))[0]
  const area: FlowSynthesisArea = { areaId: 'tasks', claims: [{ doc: DOC, anchor: ANCHOR, title: CLAIM, driver: 'cli' }],
    docs: [{ doc: DOC, outline: doc.sections.map(s => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })) }] }
  return { root, doc, area }
}

/** The flow the web fixture's own action realizes — the shortlist's terms. */
function webFlow(): GuardFlow {
  const milestones = [{ order: 1, doc: 'synthetic.md', anchor: 'creation', claimTitle: 'Creating an organisation displays its dialog', proofDrivers: ['web' as const] }]
  return { id: 'organisation', title: 'Create organisation', goal: 'Show the creation dialog', fingerprint: flowFingerprint(milestones),
    milestones, bindings: [{ doc: 'synthetic.md', anchor: 'creation', fingerprint: 'sha256:doc' }], composedOf: [], synthesisInputsHash: 'same' }
}

/** Everything a flow's settle record folds except the web read-set under test. */
const BASE_PARTS: FlowGenerationInputParts = {
  flowFingerprint: 'sha256:flow',
  sectionKeys: ['docs/app.md#creation:abc'],
  assignmentFingerprints: ['assignment'],
  interfaceFingerprints: ['sha256:organisation'],
  prerequisiteMaterial: 'none',
  recipeSlice: 'slice',
  roster: 'roster',
  preparation: 'preparation',
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
    expect((await seams.extractSession({ docs: [doc], prerequisiteTargets: [] })).summary).toMatchObject({ ran: 0, fromCache: 1 })
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
  it('keys a web worker on what its session is handed, not on every screen in the catalog', async () => {
    const f = authoringFixture()
    const flow = webFlow()
    const catalog = createAuthorCatalog(f.interfaces, f.resources)
    const material = (resources: typeof f.resources): string =>
      webAuthorKeyMaterial(createAuthorCatalog(f.interfaces, resources), [f.own], flow, resources)

    // An unrelated screen's readables: the whole catalog moves, the material
    // handed to THIS flow's session does not.
    const unrelated = structuredClone(f.resources)
    unrelated.web[1].readables = { markers: [{ id: 'permission-marker', text: 'Manager access required' }] }
    expect(createAuthorCatalog(f.interfaces, unrelated).fingerprint).not.toBe(catalog.fingerprint)
    expect(material(unrelated)).toBe(material(f.resources))

    // The resource the flow's own action sits on does move it.
    const own = structuredClone(f.resources)
    own.web[0].address = '/organisations?tab=all'
    expect(material(own)).not.toBe(material(f.resources))

    const task = (surface: 'cli' | 'api' | 'web', web: string): FlowWorkerTask => ({ surface,
      cacheMaterial: { flowFingerprint: 'same-flow', sectionKeys: ['same-section'], recipeFingerprint: 'same-recipe',
        interfaceFingerprints: ['matched-interface', ...(surface === 'web' ? [web] : [])], mode: 'scratch', priorShas: [] } } as unknown as FlowWorkerTask)
    expect(flowWorkerCacheKey(task('web', material(unrelated)))).toBe(flowWorkerCacheKey(task('web', material(f.resources))))
    expect(flowWorkerCacheKey(task('web', material(own)))).not.toBe(flowWorkerCacheKey(task('web', material(f.resources))))
    for (const surface of ['cli', 'api'] as const) {
      // Only web consumes the catalog dependency. The actual worker helper
      // cannot accidentally include a catalog supplied on another surface.
      expect(flowWorkerCacheKey(task(surface, material(own)))).toBe(flowWorkerCacheKey(task(surface, material(f.resources))))
      expect(flowWorkerPromptFingerprint(surface)).not.toBe(flowWorkerPromptFingerprint('web'))
    }
    const cached = { version: GUARD_REVIEW_POLICY_VERSION - 1,
      outcome: { kind: 'settled', scenarioYamlSha: 'sha', expectedReds: [] }, scenarioYaml: 'yaml', reviews: [] }
    expect(CachedWorkerEntrySchema.safeParse(cached).success).toBe(false)
    expect(CachedWorkerEntrySchema.safeParse({ ...cached, version: GUARD_REVIEW_POLICY_VERSION }).success).toBe(true)
  })

  it('settles a web flow against the entries its session read, and nothing else', () => {
    const f = authoringFixture()
    const catalog = createAuthorCatalog(f.interfaces, f.resources)
    // A session that searched for its own action and fetched the invite screen.
    const log = recordCatalogReads(catalog)
    log.catalog.search({ query: 'create organisation', limit: 1 })
    log.catalog.get({ ids: [f.late.id] })
    // The fetched action arrives with the resources it sits on, which the
    // session reads with it.
    const served = [f.late.id, f.own.id, 'members', 'organisations'].sort()
    expect(log.ids()).toEqual(served)
    // An error page serves nothing, so nothing is recorded.
    expect(log.catalog.get({ ids: ['web/absent'] }).isError).toBe(true)
    expect(log.ids()).toEqual(served)

    const settle = (interfaces = f.interfaces, resources = f.resources): string =>
      flowGenerationInputComponents({
        ...BASE_PARTS,
        webCatalogReads: catalogReadMaterial(createAuthorCatalog(interfaces, resources), log.ids()),
      })['webCatalog.reads']

    // An unrelated archive panel the session never read leaves the flow settled.
    const elsewhere = structuredClone(f.resources)
    elsewhere.web[2].description = 'Re-authored archive record'
    expect(settle(f.interfaces, elsewhere)).toBe(settle())

    // A panel it DID read re-opens it, and so does one that has left the catalog.
    const read = structuredClone(f.resources)
    read.web[1].readables = { markers: [{ id: 'permission-marker', text: 'Manager access required' }] }
    expect(settle(f.interfaces, read)).not.toBe(settle())
    expect(settle(f.interfaces.filter((i) => i.id !== f.late.id))).not.toBe(settle())
  })

  it('hands a web worker the catalog material the pre-flight estimate rebuilds offline', async () => {
    const root = makeTempRepo(); roots.push(root)
    writeRecipe(root, { web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/health' } })
    writeCorpus(root, [{ ref: WEB_DOC }])
    writeDoc(root, WEB_DOC, '## home\nThe home page shows the heading "Guard Web Fixture".')
    const shape = { type: 'web' as const, entry: { command: ['/'] }, steps: [{ kind: 'navigate' as const, route: '/' }] }
    const home: Interface = { id: 'web/home', title: 'Home', ...shape, fingerprint: interfaceFingerprint(shape) }

    const tasks: FlowWorkerTask[] = []
    await runGenerate({
      repoRoot: root,
      interfaces: interfacesOf(root, home),
      extractSession: extractSessionBy({ home: [{ driver: 'web' }] }),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        tasks.push(task)
        return { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'credentials' }] } }
      }),
      browserPreflight: async () => ({ ok: true }),
    })

    // Everything the estimate has offline: the persisted snapshot and recipe.
    const task = tasks.find((t) => t.surface === 'web')!
    const recipe = loadRecipe(root, recipePath(root))!.recipe
    const snapshot = readMergedInterfaceCatalog(root)!
    const catalog = buildWebAuthorCatalog(
      buildSurfaceCatalogs(snapshot.interfaces).get('web')!.interfaces,
      buildServerRouteIndex(buildRouteManifest(root), recipe),
      recipe.web?.app,
      snapshot.resources,
    )
    // The plan walks the repo's one web interface.
    const flow = readFlowsFile(root)!.flows.find((f) => f.id === task.flowId)!
    expect(task.cacheMaterial.interfaceFingerprints).toContain(webAuthorKeyMaterial(catalog, [home], flow, snapshot.resources))
  }, 60_000)

  it('fills the read-set in with no session for a row that predates it', () => {
    const current = flowGenerationInputComponents({ ...BASE_PARTS, webCatalogReads: ['web/create-organisation:abc'] })
    const { 'webCatalog.reads': _absent, ...stored } = current
    // A stored row carrying no read-set gains the name and re-opens nothing;
    // once it carries one, a moved entry does re-open it.
    expect(movedSchemeInputs(stored, current)).toEqual([])
    expect(movedSchemeInputs(current, flowGenerationInputComponents({ ...BASE_PARTS, webCatalogReads: ['web/create-organisation:moved'] })))
      .toEqual(['webCatalog.reads'])
  })
})
