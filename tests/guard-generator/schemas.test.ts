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
})
