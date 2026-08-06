import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  preflightEntry,
  entryStarts,
  probesProducedOutput,
  formatEntryPreflightError,
  missingEntryScript,
  formatMissingEntryScript,
  type EntryProbe,
  type EntryProbeExecutor,
  type StepCapture,
} from '@truecourse/guard-runner'

/** A StepCapture with the fields tests care about; the rest default to a clean shape. */
function capture(over: Partial<StepCapture>): StepCapture {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    durationMs: 1,
    ...over,
  }
}

function probe(argv: string[], over: Partial<StepCapture>): EntryProbe {
  return { argv, capture: capture(over) }
}

/** An executor that maps each probe argv to a scripted capture. */
function scripted(byArgvKey: Record<string, Partial<StepCapture>>): EntryProbeExecutor {
  return async (fullArgv) => {
    // The last element is the probe arg (or none for the bare probe).
    const argvTail = fullArgv.slice(1).join(' ')
    return capture(byArgvKey[argvTail] ?? {})
  }
}

describe('entryStarts — the general (no-string-match) judgment', () => {
  it('ALIVE when any probe exits cleanly (exit 0), even if the other fails', () => {
    const probes = [probe([], { exitCode: 1, stderr: 'usage: tool <cmd>\n' }), probe(['--help'], { exitCode: 0, stdout: 'Usage…\n' })]
    expect(entryStarts(probes)).toBe(true)
  })

  it('ALIVE when both probes FAIL but differ (the entry reacted to its arguments)', () => {
    // A commander-style CLI: no-args → usage on stderr; unknown flag → a different error.
    const probes = [
      probe([], { exitCode: 64, stderr: 'unknown command: (none)\n' }),
      probe(['--help'], { exitCode: 64, stderr: 'unknown command: --help\n' }),
    ]
    expect(entryStarts(probes)).toBe(true)
  })

  it('DEAD when both probes fail IDENTICALLY (output invariant under arguments)', () => {
    const trace = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'x'\n"
    const probes = [probe([], { exitCode: 1, stderr: trace }), probe(['--help'], { exitCode: 1, stderr: trace })]
    expect(entryStarts(probes)).toBe(false)
  })

  it('DEAD when both probes are un-spawnable identically (ENOENT)', () => {
    const probes = [
      probe([], { exitCode: null, spawnError: 'spawn missingbin ENOENT' }),
      probe(['--help'], { exitCode: null, spawnError: 'spawn missingbin ENOENT' }),
    ]
    expect(entryStarts(probes)).toBe(false)
  })

  it('DEAD when both probes crash with the same signal', () => {
    const probes = [
      probe([], { exitCode: null, signal: 'SIGSEGV' }),
      probe(['--help'], { exitCode: null, signal: 'SIGSEGV' }),
    ]
    expect(entryStarts(probes)).toBe(false)
  })

  it('ALIVE when both exit 0 with identical output (a healthy no-op entry)', () => {
    // Identical output is only a DEAD signal when both FAIL; a clean exit is alive.
    const probes = [probe([], { exitCode: 0, stdout: 'help\n' }), probe(['--help'], { exitCode: 0, stdout: 'help\n' })]
    expect(entryStarts(probes)).toBe(true)
  })
})

describe('probesProducedOutput — the output gate', () => {
  it('true when any probe wrote to stdout or stderr', () => {
    expect(probesProducedOutput([probe([], { stdout: 'x' })])).toBe(true)
    expect(probesProducedOutput([probe([], {}), probe(['--version'], { stderr: 'err' })])).toBe(true)
  })
  it('false when every probe was silent (exit 0, empty streams)', () => {
    expect(
      probesProducedOutput([probe([], {}), probe(['--help'], {}), probe(['--version'], {})]),
    ).toBe(false)
  })
})

describe('preflightEntry — silent no-op entry (the output gate)', () => {
  it('fails an entry silent on EVERY probe with kind=silent and the no-op message', async () => {
    const result = await preflightEntry({
      resolvedEntry: ['/abs/noop'],
      displayEntry: ['./bin/noop'],
      exec: scripted({}), // every probe → the default clean-exit, empty-output capture
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('silent')
    expect(result.stderr).toContain('does not look like the program the scenarios drive')
    // the probed argvs are listed so the no-op verdict is one glance
    expect(result.stderr).toContain('./bin/noop --help')
    expect(result.stderr).toContain('./bin/noop --version')

    // the self-contained error carries the no-op headline + rebuild/hand-recipe hint
    const msg = formatEntryPreflightError({ entry: result.entry, buildCommand: 'make', stderr: result.stderr, kind: result.kind })
    expect(msg).toContain('produced no output')
    expect(msg).toContain('does not look like the program the scenarios drive')
    expect(msg).toContain('make') // the recipe build in the rebuild hint
    expect(msg).toContain('hand-written recipe')
  })

  it('passes a normal chatty CLI (usage on no-args, help on --help)', async () => {
    const result = await preflightEntry({
      resolvedEntry: ['/abs/cli'],
      displayEntry: ['cli'],
      exec: scripted({
        '': { exitCode: 1, stderr: 'usage: cli <cmd>\n' },
        '--help': { exitCode: 0, stdout: 'Usage: cli\n' },
        '--version': { exitCode: 0, stdout: '1.0.0\n' },
      }),
    })
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('ok')
    expect(result.stderr).toBe('')
  })

  it('passes a CLI that is silent on no-args and --help but prints on --version', async () => {
    const result = await preflightEntry({
      resolvedEntry: ['/abs/cli'],
      displayEntry: ['cli'],
      exec: scripted({
        '': { exitCode: 0 }, // silent
        '--help': { exitCode: 0 }, // silent
        '--version': { exitCode: 0, stdout: '2.4.1\n' }, // the one loud probe
      }),
    })
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('ok')
  })
})

describe('preflightEntry — silent entry (real executor)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  })
  function tempRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-silent-'))
    dirs.push(dir)
    return dir
  }

  it('a real script that exits 0 printing nothing on every probe is SILENT', async () => {
    const repo = tempRepo()
    const script = path.join(repo, 'noop.mjs')
    fs.writeFileSync(script, 'process.exit(0)\n') // no output for any argv
    const result = await preflightEntry({
      resolvedEntry: [process.execPath, script],
      displayEntry: ['node', 'noop.mjs'],
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('silent')
    expect(result.stderr).toContain('does not look like the program the scenarios drive')
  })

  it('a real script that prints only on --version PASSES', async () => {
    const repo = tempRepo()
    const script = path.join(repo, 'ver.mjs')
    fs.writeFileSync(
      script,
      "if (process.argv[2] === '--version') process.stdout.write('9.9.9\\n')\nprocess.exit(0)\n",
    )
    const result = await preflightEntry({
      resolvedEntry: [process.execPath, script],
      displayEntry: ['node', 'ver.mjs'],
    })
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('ok')
  })
})

describe('preflightEntry', () => {
  it('classifies a module-crash entry DEAD and surfaces the FULL untruncated stderr', async () => {
    const trace =
      "node:internal/modules/esm/resolve\n  throw new ERR_MODULE_NOT_FOUND(...)\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'x'\n" +
      'a'.repeat(5000) // deliberately long — must NOT be truncated
    const result = await preflightEntry({
      resolvedEntry: ['/usr/bin/node', '/abs/dist/index.js'],
      displayEntry: ['node', 'dist/index.js'],
      // Every probe crashes identically — the module load fails before argv is parsed.
      exec: scripted({
        '/abs/dist/index.js': { exitCode: 1, stderr: trace },
        '/abs/dist/index.js --help': { exitCode: 1, stderr: trace },
        '/abs/dist/index.js --version': { exitCode: 1, stderr: trace },
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('crash')
    expect(result.entry).toBe('node dist/index.js')
    expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND')
    expect(result.stderr).toContain('a'.repeat(5000)) // full, never truncated
  })

  it('passes a healthy CLI that exits nonzero with usage on no-args', async () => {
    const result = await preflightEntry({
      resolvedEntry: ['/usr/bin/node', '/abs/cli.js'],
      displayEntry: ['node', 'cli.js'],
      exec: scripted({
        '/abs/cli.js': { exitCode: 1, stderr: 'usage: mytool <command>\n' },
        '/abs/cli.js --help': { exitCode: 0, stdout: 'Usage: mytool <command>\n\nCommands:\n  build\n' },
      }),
    })
    expect(result.ok).toBe(true)
    expect(result.stderr).toBe('')
  })
})

// The live false-ALIVE (2026-07-08): a recipe entry naming a script that does not
// exist. Node's crash embeds the resolved script path — with per-probe sandboxes the
// harness's own temp path made two identical failures differ, judging the dead entry
// ALIVE. These run the REAL executor (real node, real shared sandbox), no stubs.
describe('preflightEntry — missing entry script (real executor)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  })
  function tempRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-preflight-'))
    dirs.push(dir)
    return dir
  }

  it('a missing RELATIVE script path is DEAD with the real node stderr (the exact production repro)', async () => {
    // `dist/cli.js` does not exist anywhere — resolveEntry leaves it relative, so
    // node resolves it against the (shared) sandbox cwd and crashes identically.
    const result = await preflightEntry({
      resolvedEntry: [process.execPath, 'dist/cli.js'],
      displayEntry: ['node', 'dist/cli.js'],
    })
    expect(result.ok).toBe(false)
    expect(result.stderr).toMatch(/Cannot find module|MODULE_NOT_FOUND/)
  })

  it('a missing ABSOLUTE script path is DEAD with the real node stderr', async () => {
    const abs = path.join(tempRepo(), 'nowhere', 'cli.js') // parent dir never created
    const result = await preflightEntry({
      resolvedEntry: [process.execPath, abs],
      displayEntry: ['node', abs],
    })
    expect(result.ok).toBe(false)
    expect(result.stderr).toMatch(/Cannot find module|MODULE_NOT_FOUND/)
  })

  it('with repoRoot, the dead verdict appends the missing-file diagnostic listing the siblings', async () => {
    // The production mixup: the entry names dist/cli.js, the build produced dist/cli.mjs.
    const repo = tempRepo()
    fs.mkdirSync(path.join(repo, 'dist'))
    fs.writeFileSync(path.join(repo, 'dist', 'cli.mjs'), 'export {}\n')
    const result = await preflightEntry({
      resolvedEntry: [process.execPath, 'dist/cli.js'],
      displayEntry: ['node', 'dist/cli.js'],
      repoRoot: repo,
    })
    expect(result.ok).toBe(false)
    expect(result.stderr).toMatch(/Cannot find module|MODULE_NOT_FOUND/) // the real startup stderr, kept
    expect(result.stderr).toContain('entry file not found: dist/cli.js')
    expect(result.stderr).toContain('dist/ contains: cli.mjs') // the one-glance mixup hint
  })
})

describe('missingEntryScript', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  })
  function tempRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mes-'))
    dirs.push(dir)
    return dir
  }

  it('reports the first missing path-bearing arg with its sorted siblings', () => {
    const repo = tempRepo()
    fs.mkdirSync(path.join(repo, 'dist'))
    fs.writeFileSync(path.join(repo, 'dist', 'cli.mjs'), '')
    fs.writeFileSync(path.join(repo, 'dist', 'chunk.mjs'), '')
    const m = missingEntryScript(repo, ['node', 'dist/cli.js'])!
    expect(m).toMatchObject({ arg: 'dist/cli.js', parentDir: 'dist', siblings: ['chunk.mjs', 'cli.mjs'] })
    expect(formatMissingEntryScript(m)).toContain('dist/ contains: chunk.mjs, cli.mjs')
  })

  it('returns null when every path-bearing arg exists', () => {
    const repo = tempRepo()
    fs.mkdirSync(path.join(repo, 'dist'))
    fs.writeFileSync(path.join(repo, 'dist', 'cli.js'), '')
    expect(missingEntryScript(repo, ['node', 'dist/cli.js'])).toBeNull()
  })

  it('ignores bare commands, flags, and non-path args', () => {
    const repo = tempRepo()
    expect(missingEntryScript(repo, ['node', '--experimental-vm-modules', '-m', 'pkg'])).toBeNull()
    expect(missingEntryScript(repo, ['python3'])).toBeNull()
    // A flag whose VALUE looks path-like is still a flag — never checked.
    expect(missingEntryScript(repo, ['deno', '--allow-read=/etc'])).toBeNull()
  })

  it('flags a path-anchored command (arg 0) that is missing', () => {
    const repo = tempRepo()
    const m = missingEntryScript(repo, ['./bin/tool'])!
    expect(m.arg).toBe('./bin/tool')
    expect(m.siblings).toBeNull() // bin/ was never created
    expect(formatMissingEntryScript(m)).toContain('does not exist')
  })
})
