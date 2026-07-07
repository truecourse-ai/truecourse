import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { indexRepoDocs } from '@truecourse/guard-runner'
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

describe('indexRepoDocs', () => {
  it('indexes the bound docs when there is no corpus', () => {
    const r = repo()
    writeFile(r, 'docs/a.md', '# A\nbody')
    const { indexes, missing } = indexRepoDocs(r, ['docs/a.md'])
    expect([...indexes.keys()]).toEqual(['docs/a.md'])
    expect(missing.size).toBe(0)
  })

  it('records a bound doc that is missing on disk', () => {
    const r = repo()
    const { indexes, missing } = indexRepoDocs(r, ['docs/ghost.md'])
    expect(indexes.size).toBe(0)
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
    const { indexes } = indexRepoDocs(r, ['docs/a.md'])
    expect([...indexes.keys()].sort()).toEqual(['docs/a.md', 'docs/b.md'])
  })

  it('marks a corpus-kept doc that is absent on disk as missing', () => {
    const r = repo()
    writeFile(
      r,
      '.truecourse/specs/corpus.json',
      JSON.stringify({ version: 3, docs: [{ ref: 'docs/vanished.md' }] }),
    )
    const { indexes, missing } = indexRepoDocs(r, [])
    expect(indexes.size).toBe(0)
    expect([...missing]).toEqual(['docs/vanished.md'])
  })
})
