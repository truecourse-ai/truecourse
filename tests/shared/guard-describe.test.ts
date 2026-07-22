import { describe, it, expect } from 'vitest'
import {
  describeExpect,
  describeSetupFiles,
  describeRun,
  describeScenario,
  type GuardExpect,
  type GuardScenario,
} from '@truecourse/shared'

describe('describeExpect — one sentence per matcher kind', () => {
  it('renders an exit-code assertion', () => {
    expect(describeExpect({ exit: 1 })).toEqual(['exit code is 1'])
  })

  it('renders the three stdout stream matchers', () => {
    expect(describeExpect({ stdout: { equals: 'ok' } })).toEqual(['stdout is exactly "ok"'])
    expect(describeExpect({ stdout: { contains: 'unparsable:' } })).toEqual(['stdout contains "unparsable:"'])
    expect(describeExpect({ stdout: { matches: '^v\\d+' } })).toEqual(['stdout matches /^v\\d+/'])
  })

  it('renders stderr matchers with the stderr subject', () => {
    expect(describeExpect({ stderr: { contains: 'error' } })).toEqual(['stderr contains "error"'])
  })

  it('renders the four file matchers by path', () => {
    expect(describeExpect({ files: { 'test.sql': { exists: true } } })).toEqual(['file test.sql exists'])
    expect(describeExpect({ files: { 'out.txt': { absent: true } } })).toEqual(['file out.txt is absent'])
    expect(describeExpect({ files: { 'a.txt': { equals: 'SELECT 1' } } })).toEqual(['file a.txt is exactly "SELECT 1"'])
    expect(describeExpect({ files: { 'a.txt': { contains: 'SELECT' } } })).toEqual(['file a.txt contains "SELECT"'])
  })

  it('renders every matcher in the fixed exit→stdout→stderr→files order', () => {
    const expect_: GuardExpect = {
      exit: 0,
      stdout: { contains: 'done' },
      stderr: { equals: '' },
      files: { 'fixed.sql': { exists: true } },
    }
    expect(describeExpect(expect_)).toEqual([
      'exit code is 0',
      'stdout contains "done"',
      'stderr is exactly ""',
      'file fixed.sql exists',
    ])
  })

  it('yields no lines for an empty expect', () => {
    expect(describeExpect({})).toEqual([])
  })

  it('collapses and truncates a long asserted value', () => {
    const long = 'x'.repeat(200)
    const [line] = describeExpect({ stdout: { contains: long } })
    expect(line.length).toBeLessThan(long.length)
    expect(line).toContain('…')
  })
})

describe('describeSetupFiles — the seeded-file list', () => {
  it('lists the sandbox-relative paths a setup seeds', () => {
    expect(describeSetupFiles({ files: { 'a.sql': 'SELECT 1', 'b.sql': 'SELECT 2' } })).toEqual(['a.sql', 'b.sql'])
  })

  it('is empty when there is no setup or no files', () => {
    expect(describeSetupFiles(undefined)).toEqual([])
    expect(describeSetupFiles({ env: { X: '1' } })).toEqual([])
  })
})

describe('describeRun — the full argv', () => {
  it('joins the argv into a command string', () => {
    expect(describeRun(['fix', '--force', 'test.sql'])).toBe('fix --force test.sql')
  })

  it('quotes an argument that contains whitespace', () => {
    expect(describeRun(['lint', '--rules', 'a, b'])).toBe('lint --rules "a, b"')
  })

  it('names the bare-entrypoint case for an empty argv', () => {
    expect(describeRun([])).toBe('(no arguments — runs the entrypoint as-is)')
  })
})

describe('describeScenario — the whole story', () => {
  const base: GuardScenario = {
    guard: 1,
    id: 'fix.1',
    title: 'fix rewrites the file in place',
    claim: 'Running fix on a fixable file rewrites it in place.',
    binds: { doc: 'docs/cli.md', section: 'fix', fingerprint: 'sha256:x' },
    driver: 'cli',
    setup: { files: { 'test.sql': 'select 1' } },
    steps: [{ run: ['fix', 'test.sql'], expect: { exit: 0, files: { 'test.sql': { contains: 'SELECT 1' } } } }],
    normalize: [],
  }

  it('carries the claim, seeded files, argv, and expectations', () => {
    const story = describeScenario(base)
    expect(story.claim).toBe('Running fix on a fixable file rewrites it in place.')
    expect(story.setupFiles).toEqual(['test.sql'])
    expect(story.steps).toHaveLength(1)
    expect(story.steps[0].command).toBe('fix test.sql')
    expect(story.steps[0].run).toEqual(['fix', 'test.sql'])
    expect(story.steps[0].expectations).toEqual(['exit code is 0', 'file test.sql contains "SELECT 1"'])
  })

  it('omits the claim when the scenario has none (no placeholder)', () => {
    const { claim, ...rest } = base
    void claim
    const story = describeScenario(rest as GuardScenario)
    expect(story.claim).toBeUndefined()
    // The mechanics still render — a pre-claim scenario keeps its story.
    expect(story.steps[0].expectations).toContain('exit code is 0')
  })

  it('surfaces stdin and a >1 repeat, and skips a repeat of 1', () => {
    const story = describeScenario({
      ...base,
      steps: [
        { run: ['read'], stdin: 'hello', repeat: 3, expect: { exit: 0 } },
        { run: ['once'], repeat: 1, expect: { exit: 0 } },
      ],
    })
    expect(story.steps[0].stdin).toBe('hello')
    expect(story.steps[0].repeat).toBe(3)
    expect(story.steps[1].repeat).toBeUndefined()
  })
})
