import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSpecBundle } from '../../packages/analyzer/src/spec-sources/files'

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-source-'))
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

function writeFile(rel: string, content: string): void {
  const abs = path.join(repoPath, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

describe('spec-source: file discovery', () => {
  it('finds SPEC.md at repo root', () => {
    writeFile('SPEC.md', '# Title\n\nbody\n')
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.empty).toBe(false)
    expect(bundle.sections.length).toBeGreaterThan(0)
  })

  it('finds docs/SPEC.md', () => {
    writeFile('docs/SPEC.md', '# Title\nbody\n')
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.empty).toBe(false)
  })

  it('finds PRD-*.md files via glob', () => {
    writeFile('PRD-orders.md', '# Orders\nbody\n')
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.empty).toBe(false)
    expect(bundle.sections[0].sourcePath).toBe('PRD-orders.md')
  })

  it('skips README.md when a non-last-resort spec is present', () => {
    writeFile('SPEC.md', '# Spec\nbody\n')
    writeFile('README.md', '# Readme\nbody\n')
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.sections.every((s) => !s.sourcePath.endsWith('README.md'))).toBe(true)
  })

  it('falls back to README.md as last resort', () => {
    writeFile('README.md', '# Readme\nbody\n')
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.empty).toBe(false)
    expect(bundle.sections.some((s) => s.sourcePath === 'README.md')).toBe(true)
  })

  it('returns empty bundle when no spec files exist', () => {
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.empty).toBe(true)
    expect(bundle.sections).toEqual([])
    expect(bundle.searchedPaths.length).toBeGreaterThan(0)
  })

  it('honors explicit override in .truecourse/config.json', () => {
    writeFile('SPEC.md', '# Default\nbody\n')
    writeFile('docs/custom-spec.md', '# Custom\noverride content\n')
    writeFile(
      '.truecourse/config.json',
      JSON.stringify({ spec: 'docs/custom-spec.md' }),
    )
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.sections[0].sourcePath).toBe('docs/custom-spec.md')
    expect(bundle.sections[0].content).toContain('override content')
  })
})

describe('spec-source: section parsing', () => {
  it('splits markdown into sections by H1/H2 headings', () => {
    writeFile(
      'SPEC.md',
      `# First\n\nbody1\n\n## Second\n\nbody2\n\n# Third\n\nbody3\n`,
    )
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.sections).toHaveLength(3)
    expect(bundle.sections.map((s) => s.heading)).toEqual(['First', 'Second', 'Third'])
  })

  it('produces stable section ids', () => {
    writeFile('SPEC.md', `# POST /users\n\nbody\n`)
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.sections[0].id).toBe('FILE:SPEC.md#post-users')
  })

  it('hashes section content', () => {
    writeFile('SPEC.md', '# Section\n\nfirst content\n')
    const a = loadSpecBundle(repoPath).sections[0].contentHash
    expect(a).toMatch(/^[a-f0-9]{16}$/)

    fs.writeFileSync(path.join(repoPath, 'SPEC.md'), '# Section\n\nsecond content\n')
    const b = loadSpecBundle(repoPath).sections[0].contentHash
    expect(b).not.toBe(a)
  })

  it('handles spec files without headings', () => {
    writeFile('SPEC.md', 'just some prose, no headings.\n')
    const bundle = loadSpecBundle(repoPath)
    expect(bundle.empty).toBe(false)
    expect(bundle.sections).toHaveLength(1)
  })
})
