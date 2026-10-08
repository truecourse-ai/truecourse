/**
 * The document trees a run resolves its binds against: the docs the scenarios
 * bind to, unioned with the corpus-kept docs, each parsed once; a referenced
 * doc absent on disk is recorded missing.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readRepoDocTrees } from '@truecourse/guard-runner'
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

function writeFile(root: string, rel: string, content: string): void {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

describe('readRepoDocTrees', () => {
  it('parses the bound docs when there is no corpus', () => {
    const r = repo()
    writeFile(r, 'docs/a.md', '# A\nbody')
    const { trees, missing } = readRepoDocTrees(r, ['docs/a.md'])
    expect([...trees.keys()]).toEqual(['docs/a.md'])
    expect(trees.get('docs/a.md')!.sections.map((s) => s.anchor)).toEqual(['a'])
    expect(missing.size).toBe(0)
  })

  it('records a bound doc that is missing on disk', () => {
    const r = repo()
    const { trees, missing } = readRepoDocTrees(r, ['docs/ghost.md'])
    expect(trees.size).toBe(0)
    expect([...missing]).toEqual(['docs/ghost.md'])
  })

  it('unions corpus-kept docs with the bound docs', () => {
    const r = repo()
    writeFile(r, 'docs/a.md', '# A\nbody')
    writeFile(r, 'docs/b.md', '# B\nbody')
    writeFile(
      r,
      '.truecourse/specs/corpus.json',
      JSON.stringify({ version: 3, docs: [{ ref: 'docs/b.md' }] }),
    )
    const { trees } = readRepoDocTrees(r, ['docs/a.md'])
    expect([...trees.keys()].sort()).toEqual(['docs/a.md', 'docs/b.md'])
  })

  it('marks a corpus-kept doc that is absent on disk as missing', () => {
    const r = repo()
    writeFile(
      r,
      '.truecourse/specs/corpus.json',
      JSON.stringify({ version: 3, docs: [{ ref: 'docs/vanished.md' }] }),
    )
    const { trees, missing } = readRepoDocTrees(r, [])
    expect(trees.size).toBe(0)
    expect([...missing]).toEqual(['docs/vanished.md'])
  })
})
