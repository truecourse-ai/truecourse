import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluateExpect } from '@truecourse/guard-runner'

let cwd: string
const identity = (t: string): string => t

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-expect-'))
})
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
})

function evalExpect(expectObj: Parameters<typeof evaluateExpect>[0]['expect'], over: Partial<Parameters<typeof evaluateExpect>[0]> = {}) {
  return evaluateExpect({
    expect: expectObj,
    exitCode: 0,
    stdout: '',
    stderr: '',
    sandboxCwd: cwd,
    normalizeText: identity,
    ...over,
  })
}

describe('evaluateExpect — exit', () => {
  it('passes on a matching exit code', () => {
    expect(evalExpect({ exit: 0 })).toBeNull()
  })
  it('fails on a mismatched exit code', () => {
    const m = evalExpect({ exit: 0 }, { exitCode: 1 })
    expect(m?.subject).toBe('exit')
    expect(m?.expected).toContain('exit 0')
    expect(m?.actual).toContain('exit 1')
  })
})

describe('evaluateExpect — streams', () => {
  it('stdout equals', () => {
    expect(evalExpect({ stdout: { equals: 'hi\n' } }, { stdout: 'hi\n' })).toBeNull()
    expect(evalExpect({ stdout: { equals: 'hi\n' } }, { stdout: 'bye\n' })?.subject).toBe('stdout')
  })
  it('stdout contains', () => {
    expect(evalExpect({ stdout: { contains: 'rate limit' } }, { stdout: 'error: rate limit hit' })).toBeNull()
    expect(evalExpect({ stdout: { contains: 'rate limit' } }, { stdout: 'all good' })?.subject).toBe('stdout')
  })
  it('stdout matches (regex)', () => {
    expect(evalExpect({ stdout: { matches: '^\\d+\\.\\d+\\.\\d+' } }, { stdout: '2.4.1\n' })).toBeNull()
    expect(evalExpect({ stdout: { matches: '^\\d+\\.\\d+' } }, { stdout: 'nope' })?.subject).toBe('stdout')
  })
  it('stderr contains', () => {
    expect(evalExpect({ stderr: { contains: 'fatal' } }, { stderr: 'fatal: boom' })).toBeNull()
    expect(evalExpect({ stderr: { contains: 'fatal' } }, { stderr: '' })?.subject).toBe('stderr')
  })
})

describe('evaluateExpect — files', () => {
  it('exists / absent', () => {
    fs.writeFileSync(path.join(cwd, 'there.txt'), 'x')
    expect(evalExpect({ files: { 'there.txt': { exists: true } } })).toBeNull()
    expect(evalExpect({ files: { 'gone.txt': { exists: true } } })?.subject).toBe('files')
    expect(evalExpect({ files: { 'gone.txt': { absent: true } } })).toBeNull()
    expect(evalExpect({ files: { 'there.txt': { absent: true } } })?.subject).toBe('files')
  })
  it('equals / contains on file content', () => {
    fs.writeFileSync(path.join(cwd, 'out.txt'), 'name=demo\nstrict=no\n')
    expect(evalExpect({ files: { 'out.txt': { contains: 'strict=no' } } })).toBeNull()
    expect(evalExpect({ files: { 'out.txt': { equals: 'name=demo\nstrict=no\n' } } })).toBeNull()
    expect(evalExpect({ files: { 'out.txt': { contains: 'strict=yes' } } })?.subject).toBe('files')
  })
  it('matches (regex) on file content — several independent markers in one file', () => {
    fs.writeFileSync(path.join(cwd, 'report.md'), '# report\nalpha ok\nbeta ok\n')
    const both = '^(?=[\\s\\S]*alpha)(?=[\\s\\S]*beta)[\\s\\S]*$'
    expect(evalExpect({ files: { 'report.md': { matches: both } } })).toBeNull()

    fs.writeFileSync(path.join(cwd, 'half.md'), '# report\nalpha ok\n')
    const m = evalExpect({ files: { 'half.md': { matches: both } } })
    expect(m?.subject).toBe('files')
    // The diff names the PATTERN and excerpts the file, like the stream matcher's.
    expect(m?.expected).toContain(both)
    expect(m?.actual).toContain('alpha ok')
    expect(m?.detail.join('\n')).toContain(both)
    expect(m?.detail.join('\n')).toContain('alpha ok')
  })

  it('matches names an uncompilable regex instead of reporting a plain mismatch', () => {
    fs.writeFileSync(path.join(cwd, 'x.txt'), 'x')
    const m = evalExpect({ files: { 'x.txt': { matches: 'a[0-9' } } })
    expect(m?.subject).toBe('files')
    expect(m?.expected).toContain('invalid regex')
  })

  it('matches is a CONTENT check — a missing path and a directory are named as such', () => {
    fs.mkdirSync(path.join(cwd, 'store'))
    expect(evalExpect({ files: { 'nope.txt': { matches: 'x' } } })?.actual).toContain('missing')
    expect(evalExpect({ files: { store: { matches: 'x' } } })?.actual).toContain('is a directory')
  })

  it('normalizes file content before a regex comparison', () => {
    fs.writeFileSync(path.join(cwd, 'nv.txt'), 'relkit 2.4.1')
    const stripVersion = (t: string): string => t.replace(/\d+\.\d+\.\d+/g, '<VERSION>')
    expect(
      evalExpect({ files: { 'nv.txt': { matches: '^relkit <VERSION>$' } } }, { normalizeText: stripVersion }),
    ).toBeNull()
  })

  it('evaluates EVERY declared file matcher — contains passing never skips matches', () => {
    fs.writeFileSync(path.join(cwd, 'c.txt'), 'alpha\n')
    const m = evalExpect({ files: { 'c.txt': { contains: 'alpha', matches: 'beta' } } })
    expect(m?.subject).toBe('files')
    expect(m?.expected).toContain('beta')
  })

  it('exists / absent are about the PATH — a directory satisfies them', () => {
    fs.mkdirSync(path.join(cwd, 'store', 'analyses'), { recursive: true })
    expect(evalExpect({ files: { store: { exists: true } } })).toBeNull()
    expect(evalExpect({ files: { 'store/analyses': { exists: true } } })).toBeNull()
    expect(evalExpect({ files: { 'store/runs': { exists: true } } })?.actual).toContain('missing')
    expect(evalExpect({ files: { 'store/runs': { absent: true } } })).toBeNull()
    expect(evalExpect({ files: { store: { absent: true } } })?.actual).toContain('a directory')
  })
  it('refuses a CONTENT check on a directory, naming the mistake', () => {
    fs.mkdirSync(path.join(cwd, 'store'))
    const m = evalExpect({ files: { store: { contains: 'x' } } })
    expect(m?.subject).toBe('files')
    expect(m?.actual).toContain('is a directory')
    expect(m?.detail.join('\n')).toContain('which has none')
    expect(evalExpect({ files: { store: { equals: 'x' } } })?.actual).toContain('is a directory')
  })
  it('normalizes file content before comparison', () => {
    fs.writeFileSync(path.join(cwd, 'v.txt'), 'relkit 2.4.1')
    const stripVersion = (t: string): string => t.replace(/\d+\.\d+\.\d+/g, '<VERSION>')
    expect(
      evalExpect({ files: { 'v.txt': { equals: 'relkit <VERSION>' } } }, { normalizeText: stripVersion }),
    ).toBeNull()
  })
})

describe('evaluateExpect — first-failure order', () => {
  it('reports exit before stdout when both are wrong', () => {
    const m = evalExpect({ exit: 0, stdout: { contains: 'nope' } }, { exitCode: 1, stdout: 'hello' })
    expect(m?.subject).toBe('exit')
  })
  it('reports stdout before stderr when both are wrong', () => {
    const m = evalExpect(
      { stdout: { contains: 'a' }, stderr: { contains: 'b' } },
      { stdout: 'x', stderr: 'y' },
    )
    expect(m?.subject).toBe('stdout')
  })
})
