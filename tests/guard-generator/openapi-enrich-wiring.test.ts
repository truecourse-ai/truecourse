/**
 * Item 42 / B4 — the enrichment wiring: the authoring cache key and the
 * generation-inputs (WORK) hash fold the matched OpenAPI write-op schema ONLY when
 * a section references one, and the authoring prompt is handed those schemas. An
 * unmatched section is byte-identical to before enrichment on every surface.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  authorCacheKey,
  retryCacheKey,
  generationInputsHash,
  planGuardWork,
  generateGuards,
  buildAuthorUserPrompt,
  GENERATE_API_PROMPT_FINGERPRINT,
  type SectionInput,
  type AuthorUserContext,
  type GenerateRunner,
  type GuardBirthFinding,
} from '@truecourse/guard-generator'
import { writeManifest } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeApiRecipe, writeCorpus, writeDoc, extractBy } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const CLAIM = { claim: 'POST /todos requires a title', driver: 'api', sectionAnchor: 'a', reason: 'r' } as const

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
  }
}

describe('authorCacheKey — endpoint-schema fold', () => {
  it('is byte-identical to the pre-B4 key when the section matches no write op', () => {
    const key = authorCacheKey(CLAIM, section(''), 'sha256:recipe')
    // Independent oracle: the documented pre-B4 5-part formula.
    const expected = createHash('sha256')
      .update(
        [
          GENERATE_API_PROMPT_FINGERPRINT,
          'sha256:recipe',
          String(GUARD_FORMAT_VERSION),
          'sha256:sec',
          'POST /todos requires a title',
        ].join('::'),
      )
      .digest('hex')
    expect(key).toBe(expected)
  })

  it('moves once a write-op schema is matched and again when that schema changes', () => {
    const base = authorCacheKey(CLAIM, section(''), 'sha256:recipe')
    const matched = authorCacheKey(CLAIM, section('sha256:schemaA'), 'sha256:recipe')
    const changed = authorCacheKey(CLAIM, section('sha256:schemaB'), 'sha256:recipe')
    expect(matched).not.toBe(base)
    expect(changed).not.toBe(matched)
  })
})

describe('generationInputsHash — endpoint-schema fold', () => {
  it('is byte-identical when empty, and moves when non-empty', () => {
    const base = generationInputsHash('sha256:fp', 'sha256:recipe')
    expect(generationInputsHash('sha256:fp', 'sha256:recipe', '', '')).toBe(base)
    expect(generationInputsHash('sha256:fp', 'sha256:recipe', '', 'sha256:schema')).not.toBe(base)
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

  it('re-plans exactly the referencing markdown section when the OpenAPI schema changes', () => {
    const r = setupRepo(OPENAPI_V1)
    // Stamp a manifest as if every section had already generated.
    const plan0 = planGuardWork(r)
    writeManifest(r, {
      guard: GUARD_FORMAT_VERSION,
      sections: plan0.sections.map((s) => ({
        doc: s.doc,
        anchor: s.anchor,
        fingerprint: s.fingerprint,
        scenarioIds: [],
        generationInputsHash: generationInputsHash(
          s.fingerprint,
          plan0.recipeFingerprint,
          s.suppressionFingerprint,
          s.endpointSchemaFingerprint,
        ),
      })),
    })
    expect(planGuardWork(r).work).toHaveLength(0)

    // Change ONLY the OpenAPI request schema. The op section changes (its own
    // fingerprint), and the referencing markdown section must re-detect as work via
    // its endpoint-schema fold; the unrelated markdown section stays skipped.
    writeDoc(r, 'api/openapi.yaml', OPENAPI_V2)
    const work = planGuardWork(r).work
    const workHeadings = work.map((s) => s.headingText).sort()
    expect(workHeadings).toContain('Create a todo')
    expect(workHeadings).not.toContain('Unrelated behavior')
  })
})

describe('generateGuards — the api author prompt carries the matched request schema', () => {
  it('hands the OpenAPI request schema to the markdown section’s authoring batch', async () => {
    const r = setupRepo(OPENAPI_V1)
    let mdCtx: AuthorUserContext | undefined
    const spyRunner: GenerateRunner = async (ctx) => {
      if (ctx.doc === 'docs/api.md') mdCtx = ctx
      return ctx.claims.map((c) => ({ ref: c.ref, scenarios: [] }))
    }
    await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({
        'create-a-todo': [{ claim: 'POST /todos requires a title', driver: 'api', reason: 'HTTP 400' }],
        'unrelated-behavior': { untestable: 'no endpoint' },
        'paths/post-createtodo': { untestable: 'covered by the markdown claim' },
      }),
      generateRunner: spyRunner,
    })
    expect(mdCtx).toBeDefined()
    expect(mdCtx!.endpointSchemas).toHaveLength(1)
    expect(mdCtx!.endpointSchemas![0]).toMatchObject({ method: 'POST', path: '/todos' })
    expect(mdCtx!.endpointSchemas![0].requestSchema).toContain('"required"')
    expect(mdCtx!.endpointSchemas![0].requestSchema).toContain('title')
  }, 60_000)

  // Item 43 / B5 — the response-conformance guidance is gated on the batch binding to
  // an OpenAPI operation section, so a markdown-bound api scenario is never nudged
  // toward a `schema: true` that could only die at birth.
  it('renders the response-conformance guidance for an OpenAPI-op batch, byte-absent for a markdown batch', async () => {
    const r = setupRepo(OPENAPI_V1)
    const byDoc = new Map<string, AuthorUserContext>()
    const spyRunner: GenerateRunner = async (ctx) => {
      byDoc.set(ctx.doc, ctx)
      return ctx.claims.map((c) => ({ ref: c.ref, scenarios: [] }))
    }
    await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({
        'create-a-todo': [{ claim: 'POST /todos requires a title', driver: 'api', reason: 'HTTP 400' }],
        'unrelated-behavior': { untestable: 'no endpoint' },
        'paths/post-createtodo': [{ claim: 'POST /todos returns 201 with the created todo', driver: 'api', reason: 'HTTP 201' }],
      }),
      generateRunner: spyRunner,
    })
    const opCtx = byDoc.get('api/openapi.yaml')
    const mdCtx = byDoc.get('docs/api.md')
    // The OpenAPI-operation batch binds to an operation → guidance renders.
    expect(opCtx?.bindsOpenApiOperation).toBe(true)
    expect(buildAuthorUserPrompt(opCtx!)).toContain('RESPONSE SCHEMA CONFORMANCE')
    // The markdown batch does NOT → guidance is byte-absent.
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

  it('is byte-identical to the pre-B4 retry key when the section matches no write op', () => {
    const key = retryCacheKey(CLAIM, section(''), 'sha256:recipe', EVIDENCE)
    // Independent oracle: the documented pre-B4 retry formula (round-1 5-part key + evidence hash).
    const evidenceHash = createHash('sha256')
      .update(['t', '1', 'status 201', 'status 400', '', ''].join('|'))
      .digest('hex')
    const expected = createHash('sha256')
      .update(
        [
          GENERATE_API_PROMPT_FINGERPRINT,
          'sha256:recipe',
          String(GUARD_FORMAT_VERSION),
          'sha256:sec',
          'POST /todos requires a title',
          evidenceHash,
        ].join('::'),
      )
      .digest('hex')
    expect(key).toBe(expected)
  })

  it('moves once a write-op schema is matched and again when that schema changes', () => {
    const base = retryCacheKey(CLAIM, section(''), 'sha256:recipe', EVIDENCE)
    const matched = retryCacheKey(CLAIM, section('sha256:schemaA'), 'sha256:recipe', EVIDENCE)
    const changed = retryCacheKey(CLAIM, section('sha256:schemaB'), 'sha256:recipe', EVIDENCE)
    expect(matched).not.toBe(base)
    expect(changed).not.toBe(matched)
  })
})
