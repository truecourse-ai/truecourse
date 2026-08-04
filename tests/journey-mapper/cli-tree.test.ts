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

  it('maps nothing for a repo with no cli surface', () => {
    const service = analyze(
      'src/report.ts',
      `export function buildReport(rows: string[]): string { return rows.join('\\n') }`,
    )
    expect(deriveCliJourneysFromTree([service])).toEqual([])
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
    expect(merged[1].steps[0]).toMatchObject({ flags: ['--to', '--dry-run'] })
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
