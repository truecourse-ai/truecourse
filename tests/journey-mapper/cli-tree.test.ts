/**
 * The primary cli derivation: analyzer `cliCommands` artifacts → journeys. The
 * fixtures run real source through the real analyzer, so this covers the extractor
 * → mapper seam rather than hand-written artifact literals.
 */
import { describe, it, expect } from 'vitest'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import { deriveCliJourneysFromTree } from '../../packages/journey-mapper/src/cli-tree'
import type { FileAnalysis } from '../../packages/shared/src/index'

const CLI_SOURCE = `
  import { Command } from 'commander'
  import { runDeploy, runStatus } from './commands/deploy.js'

  const program = new Command()
  program.name('shipit').version('2.4.0')

  program
    .command('deploy <service>')
    .description('Deploy a service to an environment')
    .option('-e, --env <name>', 'Target environment')
    .option('--dry-run', 'Print the plan without applying it')
    .action(runDeploy)

  program
    .command('status')
    .description('Show the current rollout status')
    .option('--json', 'Emit machine-readable JSON')
    .action(runStatus)

  const configCmd = program.command('config').description('Inspect deploy configuration')
  configCmd.command('get <key>').action(printConfig)
  configCmd.command('set <key> <value>').option('--global', 'Write the user-level config').action(writeConfig)

  program.parse(process.argv)
`

function analyze(filePath: string, source: string): FileAnalysis {
  return analyzeFileContent(filePath, source, 'typescript')
}

describe('deriveCliJourneysFromTree', () => {
  const journeys = deriveCliJourneysFromTree([analyze('src/cli.ts', CLI_SOURCE)])

  it('emits one journey per command path, id-slugged and sorted', () => {
    expect(journeys.map((j) => j.id)).toEqual([
      'cli/config',
      'cli/config-get',
      'cli/config-set',
      'cli/deploy',
      'cli/status',
    ])
  })

  it('roots each journey at its argv path with a single invoke step', () => {
    const configSet = journeys.find((j) => j.id === 'cli/config-set')
    expect(configSet).toMatchObject({
      type: 'cli',
      title: 'config set',
      entry: { command: ['config', 'set'] },
      steps: [{ kind: 'invoke', command: ['config', 'set'], flags: ['--global'] }],
    })
    expect(configSet?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('carries the command description as a cosmetic step label', () => {
    const deploy = journeys.find((j) => j.id === 'cli/deploy')
    expect(deploy?.steps[0]).toMatchObject({
      flags: ['--env', '--dry-run'],
      label: 'Deploy a service to an environment',
    })
  })

  it('carries a per-flag option schema alongside the flag list', () => {
    const deploy = journeys.find((j) => j.id === 'cli/deploy')
    expect(deploy?.steps[0]).toMatchObject({
      options: [
        { flag: '--env', description: 'Target environment' },
        { flag: '--dry-run', description: 'Print the plan without applying it' },
      ],
    })
    // A command whose registration declares no flags carries no options field.
    const config = journeys.find((j) => j.id === 'cli/config')
    expect(config?.steps[0]).not.toHaveProperty('options')
  })

  it('maps nothing for a repo with no cli surface', () => {
    const service = analyze(
      'src/report.ts',
      `export function buildReport(rows: string[]): string { return rows.join('\\n') }`,
    )
    expect(deriveCliJourneysFromTree([service])).toEqual([])
  })

  it('derives the ROOT journey from the tree when the program name is known', () => {
    const withRoot = deriveCliJourneysFromTree([analyze('src/cli.ts', CLI_SOURCE)], {
      programName: 'shipit',
    })
    expect(withRoot.map((j) => j.id)).toEqual([
      'cli/root',
      'cli/config',
      'cli/config-get',
      'cli/config-set',
      'cli/deploy',
      'cli/status',
    ])
    expect(withRoot[0]).toMatchObject({
      type: 'cli',
      title: 'shipit',
      entry: { command: ['shipit'] },
      steps: [{ kind: 'invoke', command: ['shipit'], flags: ['--version', '--help'] }],
    })
    // Without a program name there is nothing to root the journey at.
    expect(journeys.map((j) => j.id)).not.toContain('cli/root')
  })

  it('marks program-level options scope program on every subcommand grammar', () => {
    const source = `
      import { Command } from 'commander'
      const program = new Command()
      program.option('--verbose', 'Print every step')
      program.command('deploy').option('--env <name>', 'Target environment').action(runDeploy)
      program.parse()
    `
    const derived = deriveCliJourneysFromTree([analyze('src/cli.ts', source)], { programName: 'ship' })
    const deploy = derived.find((j) => j.id === 'cli/deploy')
    // The program flag rides the grammar only, never the fingerprinted flag set.
    expect(deploy?.steps[0]).toMatchObject({ flags: ['--env'] })
    expect(deploy?.steps[0].options).toEqual([
      { flag: '--env', description: 'Target environment', takesValue: true, valueHint: 'name' },
      { flag: '--verbose', description: 'Print every step', scope: 'program' },
    ])
    // The root journey carries it as its own (unscoped) option.
    const root = derived.find((j) => j.id === 'cli/root')
    expect(root?.steps[0].options?.map((o) => o.flag)).toEqual(['--verbose', '--help'])
    expect(root?.steps[0].options?.every((o) => o.scope === undefined)).toBe(true)
  })

  it('program-scope options never move a subcommand fingerprint', () => {
    const without = `
      import { Command } from 'commander'
      const program = new Command()
      program.command('deploy').option('--env <name>', 'Target environment').action(runDeploy)
      program.parse()
    `
    const withProgramFlag = without.replace(
      `program.command('deploy')`,
      `program.option('--verbose', 'Print every step')\n      program.command('deploy')`,
    )
    const a = deriveCliJourneysFromTree([analyze('src/cli.ts', without)], { programName: 'ship' })
    const b = deriveCliJourneysFromTree([analyze('src/cli.ts', withProgramFlag)], { programName: 'ship' })
    const deployOf = (list: typeof a) => list.find((j) => j.id === 'cli/deploy')?.fingerprint
    expect(deployOf(b)).toBe(deployOf(a))
  })

  it('collapses a command declared in two files onto one journey, flags unioned', () => {
    const base = analyze(
      'src/cli.ts',
      `
      import { Command } from 'commander'
      const program = new Command()
      export const dbCmd = program.command('db').description('Database maintenance')
      dbCmd.command('migrate').option('--to <version>', 'Target revision').action(runMigrate)
    `,
    )
    const plugin = analyze(
      'src/plugins/migrate-dry-run.ts',
      `
      import { Command } from 'commander'
      const program = new Command()
      const dbCmd = program.command('db')
      dbCmd.command('migrate').option('--dry-run', 'Plan only').action(planMigrate)
    `,
    )
    const merged = deriveCliJourneysFromTree([base, plugin])
    expect(merged.map((j) => j.id)).toEqual(['cli/db', 'cli/db-migrate'])
    expect(merged[1].steps[0]).toMatchObject({
      flags: ['--to', '--dry-run'],
      options: [
        { flag: '--to', description: 'Target revision' },
        { flag: '--dry-run', description: 'Plan only' },
      ],
    })
  })
})

describe('journey fingerprints — surface-visible shape only', () => {
  it('survives a file rename, a handler rename, and a description rewrite', () => {
    const original = deriveCliJourneysFromTree([analyze('src/cli.ts', CLI_SOURCE)])
    const refactored = deriveCliJourneysFromTree([
      analyze(
        'src/entrypoints/shipit-cli.ts',
        CLI_SOURCE.replace(/runDeploy/g, 'handleDeployCommand')
          .replace(/runStatus/g, 'handleStatusCommand')
          .replace('Deploy a service to an environment', 'Ship a service to an environment'),
      ),
    ])
    expect(refactored.map((j) => j.fingerprint)).toEqual(original.map((j) => j.fingerprint))
  })

  it('moves when a command gains a flag', () => {
    const before = deriveCliJourneysFromTree([analyze('src/cli.ts', CLI_SOURCE)])
    const after = deriveCliJourneysFromTree([
      analyze(
        'src/cli.ts',
        CLI_SOURCE.replace(
          `.option('--json', 'Emit machine-readable JSON')`,
          `.option('--json', 'Emit machine-readable JSON')\n    .option('--watch', 'Poll until the rollout settles')`,
        ),
      ),
    ])
    const idOf = (id: string) => (list: typeof before) => list.find((j) => j.id === id)?.fingerprint
    expect(idOf('cli/status')(after)).not.toBe(idOf('cli/status')(before))
    expect(idOf('cli/deploy')(after)).toBe(idOf('cli/deploy')(before))
  })

  it('survives a flag-description rewrite — options are metadata, never fingerprinted', () => {
    const before = deriveCliJourneysFromTree([analyze('src/cli.ts', CLI_SOURCE)])
    const after = deriveCliJourneysFromTree([
      analyze(
        'src/cli.ts',
        CLI_SOURCE.replace('Emit machine-readable JSON', 'Print JSON to stdout'),
      ),
    ])
    expect(after.map((j) => j.fingerprint)).toEqual(before.map((j) => j.fingerprint))
  })

  it('ignores the order flags are declared in', () => {
    const swapped = CLI_SOURCE.replace(
      `.option('-e, --env <name>', 'Target environment')\n    .option('--dry-run', 'Print the plan without applying it')`,
      `.option('--dry-run', 'Print the plan without applying it')\n    .option('-e, --env <name>', 'Target environment')`,
    )
    const before = deriveCliJourneysFromTree([analyze('src/cli.ts', CLI_SOURCE)])
    const after = deriveCliJourneysFromTree([analyze('src/cli.ts', swapped)])
    const deploy = (list: typeof before) => list.find((j) => j.id === 'cli/deploy')?.fingerprint
    expect(deploy(after)).toBe(deploy(before))
  })
})
