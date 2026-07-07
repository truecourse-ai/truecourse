import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadRecipe, resolveEntry, computeRecipeFingerprint, RecipeError, recipePath } from '@truecourse/guard-runner'
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

describe('computeRecipeFingerprint', () => {
  it('is stable across calls and changes when an input changes', () => {
    const r = repo()
    const a = computeRecipeFingerprint(r)
    expect(computeRecipeFingerprint(r)).toBe(a)
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: 'tmp', version: '9.9.9' }))
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
