/**
 * THE CLI UNION — `deriveCliInterfaces` stopped being
 * tree-XOR-probes: when both witnesses exist the catalog is their UNION, and
 * every disagreement is reported as a `MapperDiagnostic` for the
 * `guard-setup.reconcile-interfaces` session to settle by running the program.
 *
 * Everything here is pure: seeds go in through `buildCliInterfaces` (the one
 * place a command path becomes an interface), so what the union emits is
 * comparable byte-for-byte with what a single-source derivation of the same
 * surface would have produced. The four documented HONESTY BOUNDS get a case
 * each — an absence the probe ladder never established is not a claim, and a
 * phantom diagnostic costs a real session turn.
 */

import { describe, it, expect } from 'vitest'
import { deriveCliInterfaces, unionCliInterfaces } from '../../packages/interface-mapper/src/derive'
import {
  buildCliInterfaces,
  buildRootCliInterface,
  type CliInterfaceSeed,
} from '../../packages/interface-mapper/src/cli-interfaces'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'

/** Interfaces as one derivation would have produced them. */
const from = (...seeds: CliInterfaceSeed[]) => buildCliInterfaces(seeds)

const PROGRAM = 'relkit'

/** The one interface for a command path, by its invoke step. */
function commandOf(interfaces: readonly { steps: { kind: string; command?: string[]; flags?: string[] }[] }[], path: string) {
  return interfaces.find((i) => i.steps[0]?.command?.join(' ') === path)
}

describe('unionCliInterfaces — flags', () => {
  it('fills a flag the tree missed, keeps tree order, and reports it once', () => {
    const tree = from({ path: ['add'], flags: ['--json'], label: 'Add a release' })
    const probes = from({ path: ['add'], flags: ['--json', '--transport'] })

    const union = unionCliInterfaces(tree, probes, PROGRAM)

    expect(union.source).toBe('union')
    expect(commandOf(union.interfaces, 'add')?.steps[0].flags).toEqual(['--json', '--transport'])
    expect(union.diagnostics).toEqual([
      {
        surface: 'cli',
        kind: 'tree-missing-flag',
        subject: 'relkit add --transport',
        detail: expect.stringContaining('--transport'),
        command: ['add'],
        flag: '--transport',
      },
    ])
  })

  it('keeps a flag only the tree registers and reports it as the probe missing it', () => {
    const tree = from({ path: ['add'], flags: ['--json', '--force'] })
    const probes = from({ path: ['add'], flags: ['--json'] })

    const union = unionCliInterfaces(tree, probes, PROGRAM)

    expect(commandOf(union.interfaces, 'add')?.steps[0].flags).toEqual(['--json', '--force'])
    expect(union.diagnostics).toEqual([
      {
        surface: 'cli',
        kind: 'probe-missing-flag',
        subject: 'relkit add --force',
        detail: expect.stringContaining('--force'),
        command: ['add'],
        flag: '--force',
      },
    ])
  })

  // Honesty bound 1: nested commands are read out of a parent's help and never
  // probed themselves, so a zero-flag probe seed observed nothing about flags.
  it('says nothing about flags when the probe seed carries none', () => {
    const tree = from({ path: ['add'], flags: ['--json', '--force'] })
    const probes = from({ path: ['add'], flags: [] })

    const union = unionCliInterfaces(tree, probes, PROGRAM)

    expect(union.diagnostics).toEqual([])
    expect(commandOf(union.interfaces, 'add')?.steps[0].flags).toEqual(['--json', '--force'])
  })

  // Honesty bound 3: every help transcript prints these and no registration does.
  it('never fills or disputes the framework help flags', () => {
    const tree = from({ path: ['add'], flags: ['--json', '-h'] })
    const probes = from({ path: ['add'], flags: ['--json', '--help', '-h', '--version', '-V'] })

    const union = unionCliInterfaces(tree, probes, PROGRAM)

    expect(union.diagnostics).toEqual([])
    expect(commandOf(union.interfaces, 'add')?.steps[0].flags).toEqual(['--json', '-h'])
  })
})

describe('unionCliInterfaces — commands', () => {
  it('appends a command only the probes saw, filtering the implicit flags off it', () => {
    const tree = from({ path: ['add'], flags: [] })
    const probes = from({ path: ['add'], flags: [] }, { path: ['export'], flags: ['--out', '--help'] })

    const union = unionCliInterfaces(tree, probes, PROGRAM)

    const appended = commandOf(union.interfaces, 'export')
    expect(appended?.steps[0].flags).toEqual(['--out'])
    // Byte-identical to a single-source derivation of the same seed: the union
    // rebuilds through `buildCliInterfaces`, so ids and fingerprints cannot drift.
    const alone = buildCliInterfaces([{ path: ['export'], flags: ['--out'] }])[0]
    expect(appended?.id).toBe(alone.id)
    expect(appended?.fingerprint).toBe(alone.fingerprint)
    expect(union.diagnostics).toEqual([
      {
        surface: 'cli',
        kind: 'tree-missing-command',
        subject: 'relkit export',
        detail: expect.stringContaining('export'),
        command: ['export'],
      },
    ])
  })

  // Honesty bound 2: depth 1 is what the root help enumerates; a deeper tree
  // command is outside the ladder's one-level reach.
  it('disputes a depth-1 command the probes missed and stays silent about a deeper one', () => {
    const tree = from(
      { path: ['sync'], flags: [] },
      { path: ['spec', 'docs', 'exclude'], flags: [] },
      { path: ['add'], flags: [] },
    )
    const probes = from({ path: ['add'], flags: [] })

    const union = unionCliInterfaces(tree, probes, PROGRAM)

    expect(union.diagnostics).toEqual([
      {
        surface: 'cli',
        kind: 'probe-missing-command',
        subject: 'relkit sync',
        detail: expect.stringContaining('sync'),
        command: ['sync'],
      },
    ])
    // Both are kept — the union never drops a fact either witness stated.
    expect(union.interfaces.map((i) => i.steps[0].command.join(' ')).sort()).toEqual([
      'add',
      'spec docs exclude',
      'sync',
    ])
  })
})

describe('unionCliInterfaces — identity', () => {
  it('moves the fingerprint of an interface that gained a flag and nobody else’s', () => {
    const tree = from({ path: ['add'], flags: ['--json'] }, { path: ['list'], flags: ['--all'] })
    const probes = from({ path: ['add'], flags: ['--json', '--transport'] }, { path: ['list'], flags: ['--all'] })

    const union = unionCliInterfaces(tree, probes, PROGRAM)

    expect(commandOf(union.interfaces, 'add')?.fingerprint).not.toBe(commandOf(tree, 'add')?.fingerprint)
    expect(commandOf(union.interfaces, 'list')).toEqual(commandOf(tree, 'list'))
  })

  it('keeps the tree’s description — the probe seeds carry none', () => {
    const tree = from({ path: ['add'], flags: ['--json'], label: 'Add a release' })
    const probes = from({ path: ['add'], flags: ['--json', '--transport'] })

    const union = unionCliInterfaces(tree, probes, PROGRAM)

    expect(commandOf(union.interfaces, 'add')?.steps[0].label).toBe('Add a release')
  })
})

describe('deriveCliInterfaces — which composition a repo gets', () => {
  /** A one-command commander registration — the tree half of a real repo. */
  const treeAnalyses = [
    analyzeFileContent(
      'src/cli.ts',
      `
      import { Command } from 'commander'
      const program = new Command()
      program
        .command('add <name>')
        .description('Add a release')
        .option('--json', 'Emit JSON')
        .action(runAdd)
      program.parse()
    `,
      'typescript',
    ),
  ]

  const ENTRY = ['node', 'cli.js']
  /** Canned help per argv, exactly as the ladder walks it (`''`, `--help`, `<cmd> --help`). */
  const probeOf = (transcripts: Record<string, string>) => ({
    entry: ENTRY,
    programName: PROGRAM,
    exec: async (argv: readonly string[]) => ({
      stdout: transcripts[argv.slice(ENTRY.length).join(' ')] ?? '',
      stderr: '',
      exitCode: 0,
    }),
  })

  it('is the tree alone when no probe options are given', async () => {
    const catalog = await deriveCliInterfaces({ fileAnalyses: treeAnalyses })
    expect(catalog.source).toBe('tree')
    expect(catalog.diagnostics).toEqual([])
    expect(catalog.interfaces.map((i) => i.id)).toEqual(['cli/add'])
  })

  const ROOT_HELP = 'Usage: relkit [options] [command]\n\nCommands:\n  add [options] <name>  Add a release\n'

  it('is the probes alone when the tree derived nothing', async () => {
    const catalog = await deriveCliInterfaces({
      fileAnalyses: [],
      probe: probeOf({ '': ROOT_HELP, '--help': ROOT_HELP }),
    })

    expect(catalog.source).toBe('probes')
    expect(catalog.diagnostics).toEqual([])
    expect(catalog.interfaces.map((i) => i.id)).toEqual(['cli/add'])
  })

  it('unions both witnesses and reports the disagreement when both exist', async () => {
    const catalog = await deriveCliInterfaces({
      fileAnalyses: treeAnalyses,
      probe: probeOf({
        '': ROOT_HELP,
        '--help': ROOT_HELP,
        // The help documents a flag the registration does not, and omits one it does.
        'add --help':
          'Usage: relkit add [options] <name>\n\nOptions:\n  --transport <kind>  Upload transport\n  -h, --help  display help\n',
      }),
    })

    expect(catalog.source).toBe('union')
    expect(catalog.diagnostics.map((d) => `${d.kind} ${d.subject}`)).toEqual([
      'tree-missing-flag relkit add --transport',
      'probe-missing-flag relkit add --json',
    ])
    // Both witnesses' facts are carried; the session decides what comes off.
    expect(commandOf(catalog.interfaces, 'add')?.steps[0].flags).toEqual(['--json', '--transport'])
  })

  // Honesty bound 4: a walk that produced only the ROOT interface parsed no
  // command list at all — it observed nothing, so the union is the tree and the
  // source says `tree`, not `union`.
  it('short-circuits a root-only probe result to the tree, with no diagnostics', async () => {
    const catalog = await deriveCliInterfaces({
      fileAnalyses: treeAnalyses,
      probe: probeOf({ '': 'relkit 2.4.1 — see the manual', '--help': 'relkit — the release helper. See https://example.com/docs' }),
    })

    expect(catalog.source).toBe('tree')
    expect(catalog.diagnostics).toEqual([])
    expect(catalog.interfaces.map((i) => i.id)).toEqual(['cli/add'])
  })

  it('would otherwise have disputed the root as a probe-only command', () => {
    // Why the short-circuit exists at all: the pure union has no way to know a
    // root-only result is an absence of observation rather than a claim.
    const union = unionCliInterfaces(from({ path: ['add'], flags: [] }), [buildRootCliInterface(PROGRAM)], PROGRAM)
    expect(union.diagnostics.map((d) => d.kind)).toEqual(['probe-missing-command', 'tree-missing-command'])
  })
})
