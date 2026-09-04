import { describe, it, expect } from 'vitest'
import { dump as yamlDump } from 'js-yaml'
import {
  RecipeProposalSchema,
  RawGeneratedScenarioSchema,
  RawGeneratedWebScenarioSchema,
  rawScenarioSchemaFor,
  parseRawScenarioYaml,
} from '@truecourse/guard-generator'

describe('RecipeProposalSchema', () => {
  it('accepts an optional install command', () => {
    const parsed = RecipeProposalSchema.safeParse({
      install: 'npm ci',
      build: 'npm run build',
      entry: ['node', 'dist/cli.js'],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.install).toBe('npm ci')
  })

  it('still accepts a proposal without install (back-compat)', () => {
    const parsed = RecipeProposalSchema.safeParse({ build: 'true', entry: ['node', 'x.js'] })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.install).toBeUndefined()
  })

  it('rejects an empty install command', () => {
    const parsed = RecipeProposalSchema.safeParse({ install: '', build: 'true', entry: ['node', 'x.js'] })
    expect(parsed.success).toBe(false)
  })

  it('accepts a multi-service api proposal and enforces the one-of rule', () => {
    const servers = {
      web: { serve: ['yarn', 'workspace', '@acme/web', 'start'], healthPath: '/api/health', app: 'apps/web' },
      'api-v2': { serve: ['yarn', 'workspace', '@acme/api-v2', 'start'], app: 'apps/api/v2' },
    }
    const ok = RecipeProposalSchema.safeParse({ build: 'true', api: { servers, defaultServer: 'web' } })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.api?.servers?.['api-v2'].app).toBe('apps/api/v2')

    // Both shapes at once, neither shape, and a missing default past one server.
    expect(
      RecipeProposalSchema.safeParse({ build: 'true', api: { serve: ['node', 'x.js'], servers, defaultServer: 'web' } })
        .success,
    ).toBe(false)
    expect(RecipeProposalSchema.safeParse({ build: 'true', api: { healthPath: '/health' } }).success).toBe(false)
    expect(RecipeProposalSchema.safeParse({ build: 'true', api: { servers } }).success).toBe(false)
    expect(
      RecipeProposalSchema.safeParse({ build: 'true', api: { servers, defaultServer: 'nope' } }).success,
    ).toBe(false)
  })

  it('accepts an api-only proposal — an http server has no cli entry', () => {
    const parsed = RecipeProposalSchema.safeParse({
      build: 'true',
      api: { serve: ['uvicorn', 'app.main:app', '--port', '${PORT}'], healthPath: '/healthz' },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.entry).toBeUndefined()
    expect(parsed.data.api?.serve).toEqual(['uvicorn', 'app.main:app', '--port', '${PORT}'])
  })

  it('accepts a proposal preparing BOTH drivers, with api env', () => {
    const parsed = RecipeProposalSchema.safeParse({
      build: 'dotnet build -c Release',
      entry: ['node', 'dist/cli.js'],
      api: {
        serve: ['dotnet', 'bin/Release/app.dll'],
        env: { ASPNETCORE_URLS: 'http://127.0.0.1:${PORT}' },
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.api?.env).toEqual({ ASPNETCORE_URLS: 'http://127.0.0.1:${PORT}' })
  })

  it('rejects a proposal preparing NEITHER driver', () => {
    const parsed = RecipeProposalSchema.safeParse({ build: 'true' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0].message).toMatch(/`entry` \(cli driver\) and\/or an `api` block/)
  })

  it('rejects an api block with an empty serve argv or a relative healthPath', () => {
    expect(RecipeProposalSchema.safeParse({ build: 'true', api: { serve: [] } }).success).toBe(false)
    expect(
      RecipeProposalSchema.safeParse({ build: 'true', api: { serve: ['x'], healthPath: 'health' } }).success,
    ).toBe(false)
  })

  it('rejects the runner-only api fields — credentials/seed/services are never model-proposed', () => {
    const parsed = RecipeProposalSchema.safeParse({
      build: 'true',
      api: { serve: ['node', 'server.js'], credentials: { k: { header: 'x-api-key', value: 's3cret' } } },
    })
    expect(parsed.success).toBe(false)
  })

  // The sqlfluff defect: a proposed `entry: ["true"]` exits 0 silently for every
  // argv, so every scenario "passes" against nothing. Rejected here so it cannot
  // reach disk from a fresh proposal or the discovery cache.
  it('rejects a proposal whose entry is a shell no-op', () => {
    for (const argv0 of ['true', 'false', ':', '/bin/true']) {
      const parsed = RecipeProposalSchema.safeParse({ build: 'true', entry: [argv0] })
      expect(parsed.success).toBe(false)
      if (!parsed.success) expect(parsed.error.issues[0].message).toMatch(/not a shell no-op/)
    }
  })
})

describe('RawGeneratedWebScenarioSchema — the web arm admits one world', () => {
  const nav = { driver: 'web', navigate: '/', expect: { visible: { role: 'heading', name: 'Board' } } }
  const run = { run: ['add', 'x'], expect: { exit: 0 } }
  const request = { request: { method: 'GET', path: '/api/notes' }, expect: { status: 200 } }
  const parse = (steps: unknown[]) => RawGeneratedWebScenarioSchema.safeParse({ title: 't', steps })

  it('accepts a web-only draft', () => {
    expect(parse([nav]).success).toBe(true)
  })

  it('accepts a mixed draft — cli seed, web steps, api verification', () => {
    expect(parse([run, nav, request]).success).toBe(true)
  })

  it('rejects a draft with no web step, saying which surface it belongs on', () => {
    const parsed = parse([run, request])
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain('at least one `driver: web` step')
    }
  })

  it('rejects the reference-corpus cli verbs — authored cli vocabulary is `run` only', () => {
    expect(parse([nav, { git: ['init'] }]).success).toBe(false)
    expect(parse([nav, { write: { 'a.txt': 'x' } }]).success).toBe(false)
  })

  it('rejects the api lifecycle verbs — the sandbox owns the served surface', () => {
    expect(parse([nav, { boot: {} }]).success).toBe(false)
    expect(parse([nav, { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } }]).success).toBe(false)
    expect(parse([nav, { logs: { stream: 'stdout', match: 'x' } }]).success).toBe(false)
  })

  it('rejects a locator carrying two handles at once', () => {
    expect(parse([{ driver: 'web', click: { role: 'button', name: 'Save', text: 'Save' } }]).success).toBe(false)
  })

  it('keeps a pure-cli draft resolving through the union unchanged', () => {
    const parsed = RawGeneratedScenarioSchema.safeParse({ title: 't', steps: [run] })
    expect(parsed.success).toBe(true)
  })
})

describe('rawScenarioSchemaFor — drafts parse against the surface the engine asked for', () => {
  it('maps each runnable surface to its own arm and falls back to the union', () => {
    expect(rawScenarioSchemaFor('web')).toBe(RawGeneratedWebScenarioSchema)
    expect(rawScenarioSchemaFor('tui')).toBe(RawGeneratedScenarioSchema)
  })

  it('reports the real field path on a web defect, never `(root): Invalid input`', () => {
    const text = yamlDump({
      title: 't',
      steps: [{ driver: 'web', click: { role: 'buton', name: 'Save' } }],
    })
    const parsed = parseRawScenarioYaml(text, 'web')
    expect('error' in parsed && parsed.error).toContain('steps.0.click.role')
    expect('error' in parsed && parsed.error).not.toContain('(root)')
  })

  it('still refuses engine-owned fields before any schema runs', () => {
    const parsed = parseRawScenarioYaml(yamlDump({ id: 'x', title: 't', steps: [] }), 'web')
    expect('error' in parsed && parsed.error).toContain('engine-owned')
  })

  it('a surface-less call keeps resolving through the whole union', () => {
    const parsed = parseRawScenarioYaml(
      yamlDump({ title: 't', steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    expect('raw' in parsed).toBe(true)
  })
})
