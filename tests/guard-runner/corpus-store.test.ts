/**
 * Item 8 — the input-corpus store helpers: `writePack` seeds a pack's files + its
 * `pack.json` manifest, `loadPackInputs` reads them back in a deterministic order
 * (manifest excluded), a missing/empty pack reports a loud failure (never an empty
 * success), and a user-added file survives a re-seed (the item-9 ratchet).
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  writePack,
  readPackManifest,
  loadPackInputs,
  packDir,
} from '@truecourse/guard-runner'
import type { GuardPackManifest } from '@truecourse/shared'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempRepo, rmrf } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function manifest(pack: string, files: GuardPackManifest['files']): GuardPackManifest {
  return { pack, provenance: 'seeded from docs/x.md#s example blocks', files }
}

describe('input-corpus store (item 8)', () => {
  it('writes a pack + manifest and reads the inputs back, sorted, manifest excluded', () => {
    const r = repo()
    writePack(
      r,
      manifest('inv-a-1', [{ name: 'sample-02', source: 'seed' }, { name: 'sample-01', source: 'seed' }]),
      { 'sample-01': '{"a":1}\n', 'sample-02': '{"b":2}\n' },
    )
    const loaded = loadPackInputs(r, 'inv-a-1')
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.files.map((f) => f.name)).toEqual(['sample-01', 'sample-02'])
      expect(loaded.files[0].content).toBe('{"a":1}\n')
    }
    // pack.json is on disk but never surfaced as an input.
    expect(fs.existsSync(path.join(packDir(r, 'inv-a-1'), 'pack.json'))).toBe(true)
    expect(readPackManifest(r, 'inv-a-1')?.pack).toBe('inv-a-1')
  })

  it('fails loud for a missing pack — never an empty success', () => {
    const r = repo()
    const loaded = loadPackInputs(r, 'nope')
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) expect(loaded.reason).toContain('not found')
  })

  it('fails loud for a pack that holds only its manifest (no input files)', () => {
    const r = repo()
    writePack(r, manifest('inv-empty', []), {})
    const loaded = loadPackInputs(r, 'inv-empty')
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) expect(loaded.reason).toContain('no input files')
  })

  it('preserves a user-added file across a re-seed (the ratchet)', () => {
    const r = repo()
    // Initial pack with one seed file and one user-added repro.
    writePack(
      r,
      manifest('inv-r', [{ name: 'sample-01', source: 'seed' }, { name: 'repro.json', source: 'user' }]),
      { 'sample-01': '{"a":1}\n', 'repro.json': '{"bug":true}\n' },
    )
    // Re-seed with only the seed files — the user repro must survive on disk + manifest.
    writePack(r, manifest('inv-r', [{ name: 'sample-01', source: 'seed' }]), { 'sample-01': '{"a":2}\n' })

    const loaded = loadPackInputs(r, 'inv-r')
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.files.map((f) => f.name)).toEqual(['repro.json', 'sample-01'])
      // seed file re-written, user repro untouched.
      expect(loaded.files.find((f) => f.name === 'sample-01')!.content).toBe('{"a":2}\n')
      expect(loaded.files.find((f) => f.name === 'repro.json')!.content).toBe('{"bug":true}\n')
    }
    expect(readPackManifest(r, 'inv-r')?.files.some((f) => f.source === 'user')).toBe(true)
  })
})
