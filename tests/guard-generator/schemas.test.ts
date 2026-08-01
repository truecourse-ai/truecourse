import { describe, it, expect } from 'vitest'
import { RecipeProposalSchema } from '@truecourse/guard-generator'

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

  it('accepts a multi-service api proposal (item 75) and enforces the one-of rule', () => {
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
