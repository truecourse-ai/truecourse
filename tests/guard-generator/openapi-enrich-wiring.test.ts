/**
 * The enrichment wiring: a section's content key and the per-(flow,
 * surface) authoring cache key fold the matched OpenAPI write-op schema ONLY when
 * the section references one, and the authoring prompt is handed those schemas. An
 * unmatched section is byte-identical to before enrichment on every surface.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  authorCacheKey,
  retryCacheKey,
  sectionInputsKey,
  flowGenerationInputsHash,
  planGuardWork,
  buildAuthorUserPrompt,
  GENERATE_API_PROMPT_FINGERPRINT,
  type SectionInput,
  type AuthorUserContext,
  type GenerateRunner,
  type GuardBirthFinding,
} from '@truecourse/guard-generator'
import { writeManifest } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeCorpus,
  writeDoc,
  extractBy,
  runGenerate,
  interfacesOf,
  apiInterface,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const FLOW = { fingerprint: 'sha256:flow' }
const INTERFACES = ['sha256:interface']

function section(endpointSchemaFingerprint: string): SectionInput {
  return {
    doc: 'docs/api.md',
    anchor: 'create',
    fingerprint: 'sha256:sec',
    headingText: 'create',
    level: 2,
    ownText: '',
    fullText: '',
    areaTags: [],
    suppressionFingerprint: '',
    endpointSchemaFingerprint,
    securityFingerprint: '',
  }
}

/** The documented author-key formula, computed independently of the engine. */
function authorKeyOracle(sectionKeys: string[], extra: string[] = []): string {
  return createHash('sha256')
    .update(
      [
        GENERATE_API_PROMPT_FINGERPRINT,
        'sha256:recipe',
        String(GUARD_FORMAT_VERSION),
        'api',
        FLOW.fingerprint,
        [...sectionKeys, ...extra].sort().join('~'),
        INTERFACES.join('~'),
      ].join('::'),
    )
    .digest('hex')
}

describe('authorCacheKey — endpoint-schema fold', () => {
  it('is byte-identical to the pre-B4 key when the section matches no write op', () => {
    const key = authorCacheKey(FLOW, 'api', [sectionInputsKey(section(''))], INTERFACES, 'sha256:recipe')
    // Independent oracle: an unmatched section's content key is exactly its fingerprint.
    expect(key).toBe(authorKeyOracle(['sha256:sec']))
  })

  it('moves once a write-op schema is matched and again when that schema changes', () => {
    const key = (fp: string) =>
      authorCacheKey(FLOW, 'api', [sectionInputsKey(section(fp))], INTERFACES, 'sha256:recipe')
    expect(key('sha256:schemaA')).not.toBe(key(''))
    expect(key('sha256:schemaB')).not.toBe(key('sha256:schemaA'))
  })
})

describe('sectionInputsKey / flowGenerationInputsHash — endpoint-schema fold', () => {
  it('is byte-identical when empty, and moves when non-empty', () => {
    const base = sectionInputsKey({ fingerprint: 'sha256:fp' })
    expect(sectionInputsKey({ fingerprint: 'sha256:fp', endpointSchemaFingerprint: '' })).toBe(base)
    expect(sectionInputsKey({ fingerprint: 'sha256:fp', endpointSchemaFingerprint: 'sha256:schema' })).not.toBe(base)

    // The flow hash folds that key, so a flow binding the section re-authors.
    const hash = (sectionKey: string) =>
      flowGenerationInputsHash({
        flowFingerprint: FLOW.fingerprint,
        sectionKeys: [sectionKey],
        interfaceFingerprints: INTERFACES,
        recipeFingerprint: 'sha256:recipe',
      })
    expect(hash(sectionInputsKey({ fingerprint: 'sha256:fp', endpointSchemaFingerprint: 'sha256:schema' }))).not.toBe(
      hash(base),
    )
  })
})

// --- planGuardWork over a markdown doc that references an OpenAPI write op --------

const OPENAPI_V1 = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    post:
      operationId: createTodo
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [title]
              properties:
                title: { type: string }
      responses:
        '201': { description: created }
`
const OPENAPI_V2 = OPENAPI_V1.replace('required: [title]', 'required: [title, priority]').replace(
  'title: { type: string }',
  'title: { type: string }\n                priority: { type: integer }',
)

const MARKDOWN = `# Create a todo
Clients call \`POST /todos\` with a JSON body to create a todo.

# Unrelated behavior
Nothing about any endpoint here.
`

function setupRepo(openapi: string): string {
  const r = repo()
  writeApiRecipe(r, { entry: null })
  writeCorpus(r, [{ ref: 'api/openapi.yaml' }, { ref: 'docs/api.md' }])
  writeDoc(r, 'api/openapi.yaml', openapi)
  writeDoc(r, 'docs/api.md', MARKDOWN)
  return r
}

describe('planGuardWork — markdown → OpenAPI write-op enrichment', () => {
  it('stamps a markdown section that references a write op; leaves the op section and unrelated section empty', () => {
    const r = setupRepo(OPENAPI_V1)
    const plan = planGuardWork(r)
    const md = plan.sections.find((s) => s.doc === 'docs/api.md' && s.headingText === 'Create a todo')!
    const unrelated = plan.sections.find((s) => s.doc === 'docs/api.md' && s.headingText === 'Unrelated behavior')!
    const op = plan.sections.find((s) => s.doc === 'api/openapi.yaml')!
    expect(md.endpointSchemaFingerprint).toMatch(/^sha256:/)
    expect(unrelated.endpointSchemaFingerprint).toBe('')
    expect(op.endpointSchemaFingerprint).toBe('')
  })

  it('re-keys exactly the referencing markdown section when the OpenAPI schema changes', () => {
    const r = setupRepo(OPENAPI_V1)
    // Stamp a manifest as if one flow per section had already generated.
    const plan0 = planGuardWork(r)
    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: plan0.sections.map((s) => ({
        flowId: `${s.doc}#${s.anchor}`,
        flowFingerprint: s.fingerprint,
        bindings: [{ doc: s.doc, anchor: s.anchor, fingerprint: s.fingerprint }],
        scenarios: [],
        generationInputsHash: flowGenerationInputsHash({
          flowFingerprint: s.fingerprint,
          sectionKeys: [sectionInputsKey(s)],
          interfaceFingerprints: INTERFACES,
          recipeFingerprint: plan0.recipeFingerprint,
        }),
        gaps: [],
      })),
    })
    expect(planGuardWork(r).work).toHaveLength(0)
    const before = new Map(plan0.sections.map((s) => [`${s.doc}#${s.anchor}`, sectionInputsKey(s)]))

    // Change ONLY the OpenAPI request schema. The op section's own text moves, so it
    // is spec-side work; the referencing markdown section's text does NOT, so it is
    // not — but its content key must move via the endpoint-schema fold, which
    // re-authors every flow binding it. The unrelated markdown section stays
    // byte-identical, so its flows remain a no-op.
    writeDoc(r, 'api/openapi.yaml', OPENAPI_V2)
    const plan = planGuardWork(r)
    expect(plan.work.map((s) => s.headingText)).toEqual(['POST /todos'])
    const moved = plan.sections.filter((s) => before.get(`${s.doc}#${s.anchor}`) !== sectionInputsKey(s))
    expect(moved.map((s) => s.headingText).sort()).toEqual(['Create a todo', 'POST /todos'])
  })
})

describe('generateGuards — the api author prompt carries the matched request schema', () => {
  /** Collect each (flow, surface) authoring context, refusing to author anything. */
  function collectCtxs(): { byFlow: Map<string, AuthorUserContext>; runner: GenerateRunner } {
    const byFlow = new Map<string, AuthorUserContext>()
    const runner: GenerateRunner = async (ctx) => {
      byFlow.set(ctx.flow.id, ctx)
      return { blockedOn: ['a spy runner authors nothing'] }
    }
    return { byFlow, runner }
  }

  it('hands the OpenAPI request schema to the referencing flow’s authoring call', async () => {
    const r = setupRepo(OPENAPI_V1)
    const { byFlow, runner } = collectCtxs()
    await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('POST', '/todos')),
      extractRunner: extractBy({
        'create-a-todo': [{ claim: 'POST /todos requires a title', driver: 'api', reason: 'HTTP 400' }],
        'unrelated-behavior': { untestable: 'no endpoint' },
        'paths/post-createtodo': { untestable: 'covered by the markdown claim' },
      }),
      generateRunner: runner,
    })
    const mdCtx = byFlow.get('create-a-todo')
    expect(mdCtx).toBeDefined()
    expect(mdCtx!.endpointSchemas).toHaveLength(1)
    expect(mdCtx!.endpointSchemas![0]).toMatchObject({ method: 'POST', path: '/todos' })
    expect(mdCtx!.endpointSchemas![0].requestSchema).toContain('"required"')
    expect(mdCtx!.endpointSchemas![0].requestSchema).toContain('title')
  }, 60_000)

  // Follow-up B — the rendered write-op path carries the doc's `servers` base path so
  // the model authors a request URL that hits the mounted server (`/api/v1/todos`).
  it('hands the base-pathed operation path when the spec declares a servers base path', async () => {
    const r = setupRepo(OPENAPI_V1.replace('paths:', 'servers: [{ url: /api/v1 }]\npaths:'))
    const { byFlow, runner } = collectCtxs()
    await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('POST', '/api/v1/todos')),
      extractRunner: extractBy({
        'create-a-todo': [{ claim: 'POST /todos requires a title', driver: 'api', reason: 'HTTP 400' }],
        'unrelated-behavior': { untestable: 'no endpoint' },
        'paths/post-createtodo': { untestable: 'covered by the markdown claim' },
      }),
      generateRunner: runner,
    })
    const mdCtx = byFlow.get('create-a-todo')!
    expect(mdCtx.endpointSchemas![0]).toMatchObject({ method: 'POST', path: '/api/v1/todos' })
    expect(buildAuthorUserPrompt(mdCtx)).toContain('POST /api/v1/todos')
  }, 60_000)

  // The response-conformance guidance is gated on the flow binding to
  // an OpenAPI operation section, so a markdown-bound api scenario is never nudged
  // toward a `schema: true` that could only die at birth.
  it('renders the response-conformance guidance for an OpenAPI-op flow, byte-absent for a markdown flow', async () => {
    const r = setupRepo(OPENAPI_V1)
    const { byFlow, runner } = collectCtxs()
    await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('POST', '/todos')),
      extractRunner: extractBy({
        'create-a-todo': [{ claim: 'POST /todos requires a title', driver: 'api', reason: 'HTTP 400' }],
        'unrelated-behavior': { untestable: 'no endpoint' },
        'paths/post-createtodo': [{ claim: 'POST /todos returns 201 with the created todo', driver: 'api', reason: 'HTTP 201' }],
      }),
      generateRunner: runner,
    })
    const opCtx = byFlow.get('paths-post-createtodo')
    const mdCtx = byFlow.get('create-a-todo')
    // The OpenAPI-operation flow binds an operation → guidance renders.
    expect(opCtx?.bindsOpenApiOperation).toBe(true)
    expect(buildAuthorUserPrompt(opCtx!)).toContain('RESPONSE SCHEMA CONFORMANCE')
    // The markdown flow does NOT → guidance is byte-absent.
    expect(mdCtx?.bindsOpenApiOperation).toBe(false)
    expect(buildAuthorUserPrompt(mdCtx!)).not.toContain('RESPONSE SCHEMA CONFORMANCE')
  }, 60_000)
})

describe('retryCacheKey — endpoint-schema fold', () => {
  const EVIDENCE: GuardBirthFinding = {
    doc: 'docs/api.md',
    anchor: 'create',
    title: 't',
    step: 1,
    expected: 'status 201',
    actual: 'status 400',
  }

  it('is the round-1 key plus the birth evidence, and folds nothing extra for an unmatched section', () => {
    const key = retryCacheKey(FLOW, 'api', [sectionInputsKey(section(''))], INTERFACES, 'sha256:recipe', EVIDENCE)
    // Independent oracle: the documented retry formula (round-1 key + evidence hash).
    const evidenceHash = createHash('sha256')
      .update(['t', '1', '', 'status 201', 'status 400', '', ''].join('|'))
      .digest('hex')
    const expected = createHash('sha256')
      .update([authorKeyOracle(['sha256:sec']), evidenceHash].join('::'))
      .digest('hex')
    expect(key).toBe(expected)
  })

  it('moves once a write-op schema is matched and again when that schema changes', () => {
    const key = (fp: string) =>
      retryCacheKey(FLOW, 'api', [sectionInputsKey(section(fp))], INTERFACES, 'sha256:recipe', EVIDENCE)
    expect(key('sha256:schemaA')).not.toBe(key(''))
    expect(key('sha256:schemaB')).not.toBe(key('sha256:schemaA'))
  })
})
