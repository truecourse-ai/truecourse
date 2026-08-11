import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describeTextMatcher, evaluateExpect, matchTextMatcher } from '@truecourse/guard-runner'

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

describe('describeTextMatcher — a matcher as a RECORD says it', () => {
  it('names EVERY member the matcher declares, not just the first', () => {
    // The record of a step is what it asserted. A description that stopped at the
    // first member would under-report the assertion beside a green tick — the same
    // lie as an evaluation that stopped there.
    expect(
      describeTextMatcher('the page text', {
        contains: 'cost',
        matches: 'total: \\d+',
        compare: { number: 'total: (\\d+)', atMost: '5' },
      }),
    ).toBe('the page text contains "cost" and matches /total: \\d+/ and carries a number matching /total: (\\d+)/ and is at most 5')
  })

  it('reads as one phrase for the one-member matchers a scenario usually writes', () => {
    expect(describeTextMatcher('the address', { equals: '/notes' })).toBe('the address equals "/notes"')
    expect(describeTextMatcher('the page text', { matches: '^ok$' })).toBe('the page text matches /^ok$/')
  })
})

describe('matchTextMatcher — a case-only miss names itself', () => {
  // A miss whose only difference is letter case reads, in a truncated actual,
  // exactly like missing content — that misread cost a whole misdiagnosis once.
  // The mismatch itself must say which of the two the reader has.
  it('equals: the actual carries the case-only note', () => {
    const m = matchTextMatcher('stdout', 'stdout', { equals: 'OK\n' }, 'ok\n')
    expect(m?.actual).toContain('differs only in letter case')
  })
  it('contains: the actual carries the case-only note', () => {
    const m = matchTextMatcher('stdout', 'stdout', { contains: 'Rate Limit' }, 'error: rate limit hit')
    expect(m?.actual).toContain('differs only in letter case')
  })
  it('matches: the actual carries the case-only note', () => {
    const m = matchTextMatcher('text', 'the page text', { matches: 'api\\s*2[\\s\\S]*worker' }, 'API\n2\nWORKER')
    expect(m?.actual).toContain('differs only in letter case')
  })
  it('the web text subject explains WHY: the page text is what CSS renders', () => {
    const m = matchTextMatcher('text', 'the page text', { contains: 'api' }, 'API')
    expect(m?.detail.join('\n')).toContain('CSS')
  })
  it('a cli stream miss does not mention CSS', () => {
    const m = matchTextMatcher('stdout', 'stdout', { contains: 'api' }, 'API')
    expect(m?.detail.join('\n')).not.toContain('CSS')
  })
  it('a real content miss carries no case note', () => {
    const m = matchTextMatcher('stdout', 'stdout', { contains: 'api' }, 'nothing here')
    expect(m?.actual).not.toContain('letter case')
  })
  it('an invalid regex never gains the note', () => {
    const m = matchTextMatcher('stdout', 'stdout', { matches: '(' }, 'anything')
    expect(m?.expected).toContain('invalid regex')
    expect(m?.actual).not.toContain('letter case')
  })
})

describe('matchTextMatcher — the actual is cut at the CHANNEL width, not below it', () => {
  // The web text channel carries 2000 chars; a mismatch that re-truncated it to 400
  // cut the deciding content out of the actual while the assertion had seen it.
  const long = `${'x'.repeat(450)} the deciding words ${'y'.repeat(50)}`
  it('the default stays the compact 400', () => {
    const m = matchTextMatcher('stdout', 'stdout', { contains: 'absent' }, long)
    expect(m?.actual).not.toContain('the deciding words')
    expect(m?.actual).toContain(`(${long.length} chars)`)
  })
  it('a caller-passed limit keeps the deciding content visible', () => {
    const m = matchTextMatcher('text', 'the page text', { contains: 'absent' }, long, 2_000)
    expect(m?.actual).toContain('the deciding words')
  })
  it('the limit reaches the comparison matcher too', () => {
    const m = matchTextMatcher('text', 'the page text', { compare: { number: 'total: (\\d+)' } }, long, 2_000)
    expect(m?.actual).toContain('the deciding words')
  })
})
