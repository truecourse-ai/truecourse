import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  preflightEntry,
  entryStarts,
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

describe('preflightEntry', () => {
  it('classifies a module-crash entry DEAD and surfaces the FULL untruncated stderr', async () => {
    const trace =
      "node:internal/modules/esm/resolve\n  throw new ERR_MODULE_NOT_FOUND(...)\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'x'\n" +
      'a'.repeat(5000) // deliberately long — must NOT be truncated
    const result = await preflightEntry({
      resolvedEntry: ['/usr/bin/node', '/abs/dist/index.js'],
      displayEntry: ['node', 'dist/index.js'],
      exec: scripted({ '/abs/dist/index.js': { exitCode: 1, stderr: trace }, '/abs/dist/index.js --help': { exitCode: 1, stderr: trace } }),
    })
    expect(result.ok).toBe(false)
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
