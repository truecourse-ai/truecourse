import { describe, it, expect } from 'vitest'
import {
  preflightEntry,
  entryStarts,
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
