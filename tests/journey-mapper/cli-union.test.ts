/**
 * The tree ∪ probe union: the cross-check that keeps cli grammars complete and
 * turns every static-vs-runtime disagreement into a mapper diagnostic. The tree
 * fixture runs real source through the real analyzer; the probe half is canned
 * transcripts through a fake exec.
 */
import { describe, it, expect } from 'vitest'
import { deriveCliJourneys } from '../../packages/journey-mapper/src/derive'
import { deriveCliJourneysFromTree } from '../../packages/journey-mapper/src/cli-tree'
import type { CliProbeCapture, CliProbeExec } from '../../packages/journey-mapper/src/cli-probes'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import type { FileAnalysis, JourneyDiagnostic } from '../../packages/shared/src/index'

const ENTRY = ['/usr/local/bin/node', '/repo/dist/shipit.js']

const CLI_SOURCE = `
  import { Command } from 'commander'

  const program = new Command()
  program.name('shipit').version('2.4.0')

  program
    .command('deploy')
    .description('Deploy a service to an environment')
    .option('-e, --env <name>', 'Target environment')
    .action(runDeploy)

  program
    .command('status')
    .option('--json', 'Emit machine-readable JSON')
    .option('--hidden-flag', 'Kept out of help on purpose')
    .action(runStatus)

  const configCmd = program.command('config')
  configCmd.command('get <key>').action(printConfig)
  const secretsCmd = configCmd.command('secrets')
  secretsCmd.command('rotate <name>').action(rotateSecret)

  program.parse(process.argv)
`

const ROOT_HELP = `Usage: shipit [options] [command]

Options:
  -V, --version   output the version number
  --trace         Emit a trace file per run
  -h, --help      display help for command

Commands:
  deploy [options]   Deploy a service
  status [options]   Show the rollout status
  config             Inspect configuration
  rollback           Roll back the last deploy
`

const TRANSCRIPTS: Record<string, string> = {
  '': ROOT_HELP,
  '--help': ROOT_HELP,
  'deploy --help': `Usage: shipit deploy [options]

Options:
  -e, --env <name>    Target environment (choices: "staging", "production")
  --force             Skip the confirmation prompt
  -h, --help          display help for command
`,
  'status --help': `Usage: shipit status [options]

Options:
  --json      Emit machine-readable JSON
  -h, --help  display help for command
`,
  'config --help': `Usage: shipit config [options] [command]

Commands:
  get <key>   Print one configuration value
`,
  'rollback --help': `Usage: shipit rollback [options]

Options:
  -h, --help  display help for command
`,
}

function fakeExec(calls: string[][] = []): CliProbeExec {
  return async (argv) => {
    const args = [...argv].slice(ENTRY.length)
    calls.push(args)
    const stdout = TRANSCRIPTS[args.join(' ')] ?? ''
    return { stdout, stderr: '', exitCode: stdout ? 0 : 1 } satisfies CliProbeCapture
  }
}

function analyses(): FileAnalysis[] {
  return [analyzeFileContent('src/cli.ts', CLI_SOURCE, 'typescript')]
}

async function unionCatalog(calls: string[][] = []) {
  return deriveCliJourneys({
    fileAnalyses: analyses(),
    probe: { entry: ENTRY, exec: fakeExec(calls), programName: 'shipit' },
  })
}

describe('deriveCliJourneys: tree ∪ probe union', () => {
  it('always probes alongside a non-empty tree, and records source union', async () => {
    const calls: string[][] = []
    const catalog = await unionCatalog(calls)
    expect(catalog.source).toBe('union')
    expect(calls[0]).toEqual([])
    expect(calls[1]).toEqual(['--help'])
    expect(calls).toContainEqual(['deploy', '--help'])
  })

  it('keeps every tree command, including paths deeper than the probe ladder sees', async () => {
    const catalog = await unionCatalog()
    const ids = catalog.journeys.map((j) => j.id)
    expect(ids).toContain('cli/config-secrets')
    expect(ids).toContain('cli/config-secrets-rotate')
    // Depth ≥ 3 is outside the ladder's universe: never a disagreement.
    expect(catalog.diagnostics.filter((d) => d.path.length > 2)).toEqual([])
  })

  it('adds a command only the probe saw, with a tree-missing-command diagnostic', async () => {
    const catalog = await unionCatalog()
    expect(catalog.journeys.map((j) => j.id)).toContain('cli/rollback')
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'tree-missing-command', path: ['rollback'] }),
    )
  })

  it('fills a whole flag the tree missed into the grammar, never into the flag set', async () => {
    const catalog = await unionCatalog()
    const deploy = catalog.journeys.find((j) => j.id === 'cli/deploy')
    expect(deploy?.steps[0]).toMatchObject({ flags: ['--env'] })
    expect(deploy?.steps[0].options?.map((o) => o.flag)).toEqual(['--env', '--force', '--help'])
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'tree-missing-flag', path: ['deploy'], flag: '--force' }),
    )
  })

  it('fills probe-declared choices onto a flag the tree knows, tree keeping its description', async () => {
    const catalog = await unionCatalog()
    const deploy = catalog.journeys.find((j) => j.id === 'cli/deploy')
    const env = deploy?.steps[0].options?.find((o) => o.flag === '--env')
    expect(env).toEqual({
      flag: '--env',
      description: 'Target environment',
      takesValue: true,
      valueHint: 'name',
      choices: ['staging', 'production'],
    })
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'tree-missing-flag', path: ['deploy'], flag: '--env' }),
    )
  })

  it('reports a tree flag the runtime help hides as probe-missing-flag, keeping it', async () => {
    const catalog = await unionCatalog()
    const status = catalog.journeys.find((j) => j.id === 'cli/status')
    expect(status?.steps[0]).toMatchObject({ flags: ['--json', '--hidden-flag'] })
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'probe-missing-flag', path: ['status'], flag: '--hidden-flag' }),
    )
  })

  it('the generated help flag is boilerplate: merged into grammars, never a diagnostic', async () => {
    const catalog = await unionCatalog()
    const helpDiagnostics = catalog.diagnostics.filter((d) => d.flag === '--help' || d.flag === '-h')
    expect(helpDiagnostics).toEqual([])
    const status = catalog.journeys.find((j) => j.id === 'cli/status')
    expect(status?.steps[0].options?.some((o) => o.flag === '--help')).toBe(true)
  })

  it('cross-checks the program level: probe flags the tree missed land on the root grammar', async () => {
    const catalog = await unionCatalog()
    const root = catalog.journeys.find((j) => j.id === 'cli/root')
    expect(root?.entry).toEqual({ command: ['shipit'] })
    expect(root?.steps[0]).toMatchObject({ flags: ['--version', '--help'] })
    expect(root?.steps[0].options?.map((o) => o.flag)).toEqual(['--version', '--help', '--trace'])
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'tree-missing-flag', path: [], flag: '--trace' }),
    )
  })

  it('reports a tree command the runtime listing omits, at both observed depths', async () => {
    const catalog = await unionCatalog()
    // status/deploy/config are listed; `config get` is listed under config; the
    // probe never lists `config secrets` although config's own help lists ≥ 1
    // nested command.
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'probe-missing-command', path: ['config', 'secrets'] }),
    )
    // Every depth-1 tree command IS listed, so no depth-1 probe-missing-command.
    expect(
      catalog.diagnostics.filter((d) => d.kind === 'probe-missing-command' && d.path.length === 1),
    ).toEqual([])
  })

  it('union fingerprints match the tree-only derivation for every shared command', async () => {
    const treeOnly = deriveCliJourneysFromTree(analyses(), { programName: 'shipit' })
    const catalog = await unionCatalog()
    for (const journey of treeOnly) {
      const unioned = catalog.journeys.find((j) => j.id === journey.id)
      expect(unioned?.fingerprint).toBe(journey.fingerprint)
    }
  })

  it('a crashed probe run contributes nothing: union with zero diagnostics', async () => {
    const catalog = await deriveCliJourneys({
      fileAnalyses: analyses(),
      probe: {
        entry: ENTRY,
        exec: async () => {
          throw new Error('spawn ENOENT')
        },
        programName: 'shipit',
      },
    })
    expect(catalog.source).toBe('union')
    expect(catalog.diagnostics).toEqual([])
    expect(catalog.journeys.map((j) => j.id)).toContain('cli/deploy')
  })

  it('an empty tree still degrades to the probe catalog, source probes', async () => {
    const catalog = await deriveCliJourneys({
      fileAnalyses: [],
      probe: { entry: ENTRY, exec: fakeExec(), programName: 'shipit' },
    })
    expect(catalog.source).toBe('probes')
    expect(catalog.diagnostics).toEqual([])
    expect(catalog.journeys.map((j) => j.id)).toContain('cli/rollback')
  })

  it('no probe options leaves the tree as the only source', async () => {
    const catalog = await deriveCliJourneys({ fileAnalyses: analyses(), programName: 'shipit' })
    expect(catalog.source).toBe('tree')
    expect(catalog.diagnostics).toEqual([])
    expect(catalog.journeys.map((j) => j.id)).toContain('cli/root')
  })

  it('every diagnostic parses against the shared schema shape', async () => {
    const { JourneyDiagnosticSchema } = await import('../../packages/shared/src/journeys')
    const catalog = await unionCatalog()
    expect(catalog.diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of catalog.diagnostics) {
      expect(() => JourneyDiagnosticSchema.parse(diagnostic satisfies JourneyDiagnostic)).not.toThrow()
    }
  })
})
