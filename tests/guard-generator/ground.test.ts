import { describe, it, expect, afterEach } from 'vitest'
import { resolveEntry } from '@truecourse/guard-runner'
import {
  captureProbes,
  defaultProbeExecutor,
  buildAuthorUserPrompt,
  type ProbeExecutor,
  type ProbeTranscript,
  type AuthorUserContext,
  type SectionInput,
} from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, FIXTURE_BIN } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

// The recipe entry the fixture repos use: `node <relkit bin>`.
// (Probe derivation is covered by ground-probes.test.ts.)
const ENTRY = ['node', FIXTURE_BIN]

describe('captureProbes — real fixture CLI', () => {
  it('captures exit code + stdout/stderr per probe against relkit', async () => {
    const r = repo()
    const resolvedEntry = resolveEntry(r, ENTRY)
    const transcripts = await captureProbes({
      repoRoot: r,
      probes: [['--version'], ['boom'], []],
      resolvedEntry,
      displayEntry: ENTRY,
      recipeFingerprint: 'sha256:test',
    })

    expect(transcripts.map((t) => t.argv)).toEqual([['--version'], ['boom'], []])
    // --version → exit 0, prints the version to stdout.
    expect(transcripts[0].exit).toBe(0)
    expect(transcripts[0].stdout).toContain('2.4.1')
    // boom → exit 7, writes to stderr.
    expect(transcripts[1].exit).toBe(7)
    expect(transcripts[1].stderr).toContain('fatal: intentional failure')
    // bare → default case, unknown command, exit 64.
    expect(transcripts[2].exit).toBe(64)
    expect(transcripts[2].stderr).toContain('unknown command')
    // The display command is the entry + probe argv (bare shows the entry only).
    expect(transcripts[0].command).toBe(`node ${FIXTURE_BIN} --version`)
    expect(transcripts[2].command).toBe(`node ${FIXTURE_BIN}`)
  })

  it('content-keys the transcript cache: a second run runs zero subprocesses', async () => {
    const r = repo()
    const resolvedEntry = resolveEntry(r, ENTRY)
    let execs = 0
    const spy: ProbeExecutor = (fullArgv, env) => {
      execs++
      return defaultProbeExecutor(fullArgv, env)
    }
    const opts = {
      repoRoot: r,
      probes: [['--version'], ['report']],
      resolvedEntry,
      displayEntry: ENTRY,
      recipeFingerprint: 'sha256:cache',
      exec: spy,
    }

    const first = await captureProbes(opts)
    expect(execs).toBe(2) // both probes executed on the cold run

    execs = 0
    const second = await captureProbes(opts)
    expect(execs).toBe(0) // both served from the guard/ground cache
    expect(second).toEqual(first)
  })

  it('records a hung probe as timed-out (injected executor, no real 20s wait)', async () => {
    const r = repo()
    const timedOutExec: ProbeExecutor = async () => ({
      exitCode: null,
      signal: 'SIGKILL',
      stdout: '',
      stderr: '',
      timedOut: true,
      durationMs: 20_000,
    })
    const [t] = await captureProbes({
      repoRoot: r,
      probes: [['hang']],
      resolvedEntry: resolveEntry(r, ENTRY),
      displayEntry: ENTRY,
      recipeFingerprint: 'sha256:hang',
      exec: timedOutExec,
    })
    expect(t.timedOut).toBe(true)
    expect(t.exit).toBeNull()
  })
})

describe('buildAuthorUserPrompt — REAL BEHAVIOR block', () => {
  const section: SectionInput = {
    doc: 'docs/cli.md',
    anchor: 'version',
    fingerprint: 'sha256:x',
    headingText: 'version',
    level: 2,
    ownText: '',
    fullText: '',
    areaTags: [],
  }

  function ctxWith(probes: ProbeTranscript[]): AuthorUserContext {
    return {
      doc: 'docs/cli.md',
      docContext: '## version\n`relkit --version` prints the version.',
      areaTags: [],
      recipeEntry: ENTRY,
      recipeBuild: 'true',
      claims: [{ ref: 'c0', claim: '`--version` prints the version', section }],
      probes,
    }
  }

  it('injects the captured fixture transcripts before the claims', async () => {
    const r = repo()
    const probes = await captureProbes({
      repoRoot: r,
      probes: [['--version']],
      resolvedEntry: resolveEntry(r, ENTRY),
      displayEntry: ENTRY,
      recipeFingerprint: 'sha256:prompt',
    })

    const prompt = buildAuthorUserPrompt(ctxWith(probes))
    expect(prompt).toContain('REAL BEHAVIOR (captured in an empty sandbox')
    expect(prompt).toContain(`$ node ${FIXTURE_BIN} --version`)
    expect(prompt).toContain('exit 0')
    expect(prompt).toContain('2.4.1')
    // The block precedes the claims list.
    expect(prompt.indexOf('REAL BEHAVIOR')).toBeLessThan(prompt.indexOf('CLAIMS TO AUTHOR'))
  })

  it('renders no REAL BEHAVIOR block when ungrounded (empty probes)', () => {
    const prompt = buildAuthorUserPrompt(ctxWith([]))
    expect(prompt).not.toContain('REAL BEHAVIOR')
  })

  it('marks a timed-out probe rather than printing an exit code', () => {
    const prompt = buildAuthorUserPrompt(
      ctxWith([
        {
          argv: ['hang'],
          command: 'node cli.js hang',
          exit: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: true,
        },
      ]),
    )
    expect(prompt).toContain('exit (timed out)')
  })
})
