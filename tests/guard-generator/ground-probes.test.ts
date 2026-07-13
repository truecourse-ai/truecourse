/**
 * Fix 2 (PR 1): help-surface probes. The probe derivation splits into two pure
 * functions — `deriveStaticProbes` (help surfaces: bare + always-`--help` +
 * salvaged subcommand `--help`s, split from the exact fragments that run LAST) and
 * `deriveExpansionProbes` (subcommand `--help`s discovered by scanning the bare/
 * `--help` transcripts for tokens that also appear in the claim texts) — so the
 * two-phase capture is unit-testable without subprocesses. `groundProbes` composes
 * them against an injectable `ProbeExecutor`, admitting expansion helps BEFORE
 * exact fragments under the raised cap of 10 so fragments can never starve a help.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { resolveEntry } from '@truecourse/guard-runner'
import {
  deriveStaticProbes,
  deriveExpansionProbes,
  groundProbes,
  MAX_PROBES_PER_BATCH,
  type ProbeExecutor,
  type ProbeTranscript,
} from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, FIXTURE_BIN } from './helpers.js'

const ENTRY = ['node', FIXTURE_BIN]

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('MAX_PROBES_PER_BATCH', () => {
  it('is raised to 10', () => {
    expect(MAX_PROBES_PER_BATCH).toBe(10)
  })
})

describe('deriveStaticProbes', () => {
  it('always includes a bare --help probe; exact fragments split out (program name stripped)', () => {
    expect(deriveStaticProbes(['Running `truecourse infer` reports drift.'], ['node', 'dist/index.js'])).toEqual({
      helps: [['--help']],
      fragments: [['infer']],
    })
  })

  it('strips a leading token matching the entrypoint basename or its stem', () => {
    expect(deriveStaticProbes(['`bin.mjs report` builds a bundle.'], ['node', 'bin.mjs'])).toEqual({
      helps: [['--help']],
      fragments: [['report']],
    })
    expect(deriveStaticProbes(['`cli check --strict` validates.'], ['node', 'dist/cli.js'])).toEqual({
      helps: [['--help']],
      fragments: [['check', '--strict']],
    })
  })

  it('keeps flag-bearing fragments as-is', () => {
    expect(deriveStaticProbes(['`verify --diff` shows the delta.'], ENTRY)).toEqual({
      helps: [['--help']],
      fragments: [['verify', '--diff']],
    })
  })

  it('dedupes identical exact probes across the batch', () => {
    expect(
      deriveStaticProbes(['first `spec scan` here', 'again `spec scan` and `hooks run`'], ENTRY),
    ).toEqual({ helps: [['--help']], fragments: [['spec', 'scan'], ['hooks', 'run']] })
  })

  it('falls back to the bare probe (plus --help) when a claim names no command', () => {
    expect(
      deriveStaticProbes(
        ['writes `config.json`, sets `blockedOn`, reads `.truecourse/specs/corpus.json`.'],
        ENTRY,
      ),
    ).toEqual({ helps: [[], ['--help']], fragments: [] })
  })

  it('orders the helps bare-first, then --help', () => {
    expect(deriveStaticProbes(['`report` runs', 'this section states no command'], ENTRY)).toEqual({
      helps: [[], ['--help']],
      fragments: [['report']],
    })
  })

  it('salvages a subcommand prefix from a fragment carrying value tokens', () => {
    // `add 12.50 lunch` — the whole fragment is rejected (12.50/lunch aren't
    // command tokens), but the leading `add` is salvaged as `add --help`.
    expect(deriveStaticProbes(['`add 12.50 lunch` records an expense'], ENTRY)).toEqual({
      helps: [['--help'], ['add', '--help']],
      fragments: [],
    })
  })

  it('salvages a multi-word subcommand prefix, dropping the trailing key before a value', () => {
    expect(deriveStaticProbes(['`config set currency EUR` sets the currency'], ENTRY)).toEqual({
      helps: [['--help'], ['config', 'set', '--help']],
      fragments: [],
    })
  })

  it('dedupes a salvaged prefix that repeats across claims', () => {
    expect(
      deriveStaticProbes(['`add 1.00 a` here', '`add 2.00 b` there'], ENTRY),
    ).toEqual({ helps: [['--help'], ['add', '--help']], fragments: [] })
  })

  it('derives nothing for an empty batch (no claims, no probes)', () => {
    expect(deriveStaticProbes([], ENTRY)).toEqual({ helps: [], fragments: [] })
  })

  it('caps the helps at 10 and leaves fragments uncapped (the orchestrator budgets them)', () => {
    const salvaged = Array.from({ length: 11 }, (_, i) => `\`cmd${i} 1.00\` here`)
    const { helps } = deriveStaticProbes(['prose with no command', ...salvaged], ENTRY)
    expect(helps).toHaveLength(10)
    expect(helps[0]).toEqual([]) // bare survives
    expect(helps[1]).toEqual(['--help']) // --help survives
    const { fragments } = deriveStaticProbes(
      ['commands `a` `b` `c` `d` `e` `f` `g` `h` `i` `j` `k`'],
      ENTRY,
    )
    expect(fragments).toHaveLength(11)
  })
})

describe('deriveExpansionProbes', () => {
  const helpTranscript = (stdout: string, argv: string[] = ['--help']): ProbeTranscript => ({
    argv,
    command: `node cli ${argv.join(' ')}`.trim(),
    exit: 0,
    stdout,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
  })

  const HELP = 'Usage: tool <command>\n\nCommands:\n  add\n  remove\n  config\n'

  it('emits <token> --help for subcommand tokens found in BOTH the help output and the claim texts', () => {
    const out = deriveExpansionProbes([helpTranscript(HELP)], ['add remove'], ENTRY, new Set())
    expect(out).toEqual([['add', '--help'], ['remove', '--help']])
    // `config` is listed by help but never named by the claims → excluded.
    expect(out).not.toContainEqual(['config', '--help'])
  })

  it('excludes tokens already covered by a static probe', () => {
    const out = deriveExpansionProbes([helpTranscript(HELP)], ['add remove'], ENTRY, new Set(['add']))
    expect(out).toEqual([['remove', '--help']])
  })

  it('excludes program names even when the help output lists them', () => {
    const out = deriveExpansionProbes(
      [helpTranscript('Commands:\n  node\n  add\n')],
      ['node add'],
      ENTRY,
      new Set(),
    )
    expect(out).toEqual([['add', '--help']])
  })

  it('only scans the bare/--help transcripts, not other probes', () => {
    const other = helpTranscript('Commands:\n  deploy\n', ['report'])
    const out = deriveExpansionProbes(
      [other, helpTranscript('Commands:\n  add\n')],
      ['deploy add'],
      ENTRY,
      new Set(),
    )
    // `deploy` came from a non-help transcript → ignored; only `add` expands.
    expect(out).toEqual([['add', '--help']])
  })

  it('ignores tokens shorter than 3 chars', () => {
    const out = deriveExpansionProbes([helpTranscript('Commands:\n  rm\n  add\n')], ['rm add'], ENTRY, new Set())
    expect(out).toEqual([['add', '--help']])
  })

  it('also scans the bare (empty-argv) transcript', () => {
    const bare = helpTranscript('Commands:\n  add\n', [])
    const out = deriveExpansionProbes([bare], ['add'], ENTRY, new Set())
    expect(out).toEqual([['add', '--help']])
  })
})

describe('groundProbes — two-phase capture (injected executor)', () => {
  it('captures static probes, then expansion probes derived from the --help transcript', async () => {
    const r = repo()
    const resolvedEntry = resolveEntry(r, ENTRY)
    const calls: string[][] = []
    // The injected executor: only the bare `--help` lists a subcommand (`remove`);
    // every other probe returns empty output.
    const exec: ProbeExecutor = async (fullArgv) => {
      const argv = fullArgv.slice(resolvedEntry.length)
      calls.push(argv)
      const isBareHelp = argv.length === 1 && argv[0] === '--help'
      return {
        exitCode: 0,
        signal: null,
        stdout: isBareHelp ? 'Commands:\n  add\n  remove\n' : '',
        stderr: '',
        timedOut: false,
        durationMs: 1,
      }
    }

    const transcripts = await groundProbes({
      repoRoot: r,
      claimTexts: ['`add 12.50` records; remove works too'],
      resolvedEntry,
      displayEntry: ENTRY,
      recipeFingerprint: 'sha256:two-phase',
      exec,
    })

    // Phase 1: --help (always) + salvaged `add --help`. Phase 2: `remove --help`
    // (from the --help transcript; `add` already probed via the salvage).
    expect(transcripts.map((t) => t.argv)).toEqual([['--help'], ['add', '--help'], ['remove', '--help']])
    expect(calls).toEqual([['--help'], ['add', '--help'], ['remove', '--help']])
  })

  it('never lets exact fragments evict an expansion help (priority under the cap)', async () => {
    const r = repo()
    const resolvedEntry = resolveEntry(r, ENTRY)
    const exec: ProbeExecutor = async (fullArgv) => {
      const argv = fullArgv.slice(resolvedEntry.length)
      const isBareHelp = argv.length === 1 && argv[0] === '--help'
      return {
        exitCode: 0,
        signal: null,
        stdout: isBareHelp ? 'Commands:\n  remove\n' : '',
        stderr: '',
        timedOut: false,
        durationMs: 1,
      }
    }

    // 9 exact fragments + a no-command claim (bare) + `remove` named in prose:
    // helps = bare + --help (2), budget = 8. The expansion `remove --help` is
    // admitted FIRST; only 7 of the 9 fragments fit, and `hhh`/`iii` are evicted.
    const transcripts = await groundProbes({
      repoRoot: r,
      claimTexts: ['`aaa` `bbb` `ccc` `ddd` `eee` `fff` `ggg` `hhh` `iii`', 'remove works, no command named'],
      resolvedEntry,
      displayEntry: ENTRY,
      recipeFingerprint: 'sha256:priority',
      exec,
    })

    const argvs = transcripts.map((t) => t.argv)
    expect(argvs).toHaveLength(MAX_PROBES_PER_BATCH)
    expect(argvs.slice(0, 3)).toEqual([[], ['--help'], ['remove', '--help']])
    expect(argvs).not.toContainEqual(['hhh'])
    expect(argvs).not.toContainEqual(['iii'])
  })

  it('captures exact fragments in phase 2, after the expansion helps', async () => {
    const r = repo()
    const resolvedEntry = resolveEntry(r, ENTRY)
    const calls: string[][] = []
    const exec: ProbeExecutor = async (fullArgv) => {
      const argv = fullArgv.slice(resolvedEntry.length)
      calls.push(argv)
      const isBareHelp = argv.length === 1 && argv[0] === '--help'
      return {
        exitCode: 0,
        signal: null,
        stdout: isBareHelp ? 'Commands:\n  remove\n' : '',
        stderr: '',
        timedOut: false,
        durationMs: 1,
      }
    }

    await groundProbes({
      repoRoot: r,
      claimTexts: ['`check --strict` validates; remove works too'],
      resolvedEntry,
      displayEntry: ENTRY,
      recipeFingerprint: 'sha256:fragment-phase',
      exec,
    })

    // Phase 1 is helps-only; the exact fragment runs in phase 2 behind the expansion.
    expect(calls).toEqual([['--help'], ['remove', '--help'], ['check', '--strict']])
  })

  it('fires the planned/captured progress callbacks across both phases', async () => {
    const r = repo()
    const resolvedEntry = resolveEntry(r, ENTRY)
    const exec: ProbeExecutor = async (fullArgv) => {
      const argv = fullArgv.slice(resolvedEntry.length)
      const isBareHelp = argv.length === 1 && argv[0] === '--help'
      return {
        exitCode: 0,
        signal: null,
        stdout: isBareHelp ? 'Commands:\n  remove\n' : '',
        stderr: '',
        timedOut: false,
        durationMs: 1,
      }
    }
    let planned = 0
    let captured = 0
    const transcripts = await groundProbes({
      repoRoot: r,
      claimTexts: ['`add 12.50` and remove'],
      resolvedEntry,
      displayEntry: ENTRY,
      recipeFingerprint: 'sha256:progress',
      exec,
      onProbesPlanned: (n) => (planned += n),
      onProbeCaptured: () => (captured += 1),
    })
    expect(planned).toBe(transcripts.length)
    expect(captured).toBe(transcripts.length)
  })
})
