import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadRecipe, resolveEntry, computeRecipeFingerprint, RecipeError, recipePath, RecipeSchema } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, FIXTURE_BIN } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('loadRecipe', () => {
  it('returns null when there is no recipe', () => {
    const r = repo()
    expect(loadRecipe(r, recipePath(r))).toBeNull()
  })

  it('loads a valid recipe with a fingerprint', () => {
    const r = repo()
    writeRecipe(r, { build: 'pnpm build', entry: ['node', 'dist/cli.js'] })
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.build).toBe('pnpm build')
    expect(loaded?.recipe.entry).toEqual(['node', 'dist/cli.js'])
    expect(loaded?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('loads a recipe with an install step', () => {
    const r = repo()
    writeRecipe(r, { install: 'npm ci' })
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.install).toBe('npm ci')
  })

  it('a recipe without install loads with install undefined (back-compat)', () => {
    const r = repo()
    writeRecipe(r, { build: 'pnpm build', entry: ['node', 'dist/cli.js'] })
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.install).toBeUndefined()
  })

  it('throws RecipeError on an empty install command', () => {
    const r = repo()
    fs.mkdirSync(path.dirname(recipePath(r)), { recursive: true })
    fs.writeFileSync(
      recipePath(r),
      JSON.stringify({ install: '', build: 'true', entry: ['node', 'x.js'] }),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('throws RecipeError on invalid JSON', () => {
    const r = repo()
    fs.mkdirSync(path.dirname(recipePath(r)), { recursive: true })
    fs.writeFileSync(recipePath(r), '{ not json')
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('throws RecipeError when the schema is violated', () => {
    const r = repo()
    fs.mkdirSync(path.dirname(recipePath(r)), { recursive: true })
    fs.writeFileSync(recipePath(r), JSON.stringify({ entry: [] }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })
})

describe('RecipeSchema — no-op entry rejection', () => {
  it('rejects an entry whose argv0 is a bare shell no-op', () => {
    const res = RecipeSchema.safeParse({ build: 'true', entry: ['true'] })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues.some((i) => /program under test/.test(i.message))).toBe(true)
    }
  })

  it('rejects an entry whose argv0 is an absolute-path no-op (basename match)', () => {
    expect(RecipeSchema.safeParse({ build: 'true', entry: ['/usr/bin/true'] }).success).toBe(false)
    expect(RecipeSchema.safeParse({ build: 'true', entry: ['/bin/false'] }).success).toBe(false)
    expect(RecipeSchema.safeParse({ build: 'true', entry: [':'] }).success).toBe(false)
  })

  it('accepts a real entry that invokes the program under test', () => {
    expect(RecipeSchema.safeParse({ build: 'pnpm build', entry: ['node', 'dist/cli.js'] }).success).toBe(true)
    expect(RecipeSchema.safeParse({ build: 'true', entry: ['python', '-m', 'sqlfluff'] }).success).toBe(true)
  })

  it('loadRecipe throws on a hand-written recipe.json with a no-op entry', () => {
    const r = repo()
    fs.mkdirSync(path.dirname(recipePath(r)), { recursive: true })
    fs.writeFileSync(recipePath(r), JSON.stringify({ build: 'true', entry: ['/usr/bin/true'] }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })
})

describe('computeRecipeFingerprint', () => {
  it('is stable across calls and changes when an input changes', () => {
    const r = repo()
    const a = computeRecipeFingerprint(r)
    expect(computeRecipeFingerprint(r)).toBe(a)
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: 'tmp', version: '9.9.9' }))
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })

  it('changes when a Python manifest (pyproject.toml) appears', () => {
    const r = repo()
    const a = computeRecipeFingerprint(r)
    fs.writeFileSync(path.join(r, 'pyproject.toml'), '[project]\nname = "x"\n\n[project.scripts]\nx = "x:cli"\n')
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })

  it('changes when a discovered C# project file appears', () => {
    const r = repo()
    const a = computeRecipeFingerprint(r)
    fs.mkdirSync(path.join(r, 'src', 'Tool'), { recursive: true })
    fs.writeFileSync(
      path.join(r, 'src', 'Tool', 'Tool.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>',
    )
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })
})

describe('resolveEntry', () => {
  it('pins a bare interpreter to an absolute host path (a scenario PATH cannot swap it)', () => {
    const r = repo()
    const [cmd] = resolveEntry(r, ['node', 'x'])
    expect(path.isAbsolute(cmd)).toBe(true)
    expect(path.basename(cmd)).toMatch(/^node(\.exe)?$/)
    expect(fs.existsSync(cmd)).toBe(true)
  })

  it('falls back to the bare name when the command is not on the host PATH', () => {
    const r = repo()
    const [cmd] = resolveEntry(r, ['tc-definitely-not-a-real-binary'])
    expect(cmd).toBe('tc-definitely-not-a-real-binary')
  })

  it('absolutizes a repo-relative entry file that exists', () => {
    const r = repo()
    fs.writeFileSync(path.join(r, 'entry.mjs'), '// stub')
    const resolved = resolveEntry(r, ['node', 'entry.mjs'])
    expect(resolved[1]).toBe(path.join(r, 'entry.mjs'))
    expect(path.isAbsolute(resolved[1])).toBe(true)
  })

  it('leaves flags and non-existent args untouched', () => {
    const r = repo()
    const resolved = resolveEntry(r, ['node', FIXTURE_BIN, '--flag', 'nope/missing'])
    expect(path.isAbsolute(resolved[0])).toBe(true) // interpreter pinned to the host path
    expect(resolved.slice(1)).toEqual([FIXTURE_BIN, '--flag', 'nope/missing'])
  })

  it('resolves a dot-anchored command against the repo root', () => {
    const r = repo()
    fs.mkdirSync(path.join(r, 'bin'))
    fs.writeFileSync(path.join(r, 'bin', 'cli'), '#!/bin/sh\n')
    const [cmd] = resolveEntry(r, ['./bin/cli'])
    expect(cmd).toBe(path.join(r, 'bin', 'cli'))
  })
})
