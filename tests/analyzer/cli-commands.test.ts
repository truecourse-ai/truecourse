/**
 * The `cliCommands` extractor — the cli surface's structural map, read from
 * commander's and yargs' own call signatures. The fixtures are shaped like the
 * programs this has to survive in the wild: multi-level subcommand trees held in
 * variables, options declared mid-chain, ESM and CommonJS entry files.
 */
import { describe, it, expect } from 'vitest'
import { extractCliCommands } from '../../packages/analyzer/src/extractors/cli-commands'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import { parseCode } from '../../packages/analyzer/src/parser'

function commanderCli(code: string) {
  return extractCliCommands(parseCode(code, 'typescript'), 'src/cli.ts', 'typescript')
}

function pathsOf(commands: { path: string[] }[]): string[] {
  return commands.map((c) => c.path.join(' '))
}

function flagsOf(commands: { path: string[]; flags: { flag: string }[] }[], path: string): string[] {
  return commands.find((c) => c.path.join(' ') === path)?.flags.map((f) => f.flag) ?? []
}

describe('extractCliCommands — commander', () => {
  const program = `
    import { Command } from 'commander'
    import { runDeploy, runRollback, runStatus } from './commands/deploy.js'

    const program = new Command()

    program
      .name('shipit')
      .version('2.4.0')
      .description('Deploy services from the command line')

    program
      .command('deploy <service>')
      .description('Deploy a service to an environment')
      .option('-e, --env <name>', 'Target environment', 'staging')
      .option('--dry-run', 'Print the plan without applying it')
      .option('--no-wait', 'Return before the rollout finishes')
      .action(async (service, options) => {
        await runDeploy(service, options)
      })

    program
      .command('status')
      .description('Show the current rollout status')
      .option('--json', 'Emit machine-readable JSON')
      .action(runStatus)

    const configCmd = program
      .command('config')
      .description('Inspect and change deploy configuration')

    configCmd
      .command('get <key>')
      .description('Print one configuration value')
      .action(async (key) => {
        await printConfig(key)
      })

    configCmd
      .command('set <key> <value>')
      .description('Change one configuration value')
      .option('--global', 'Write to the user-level config instead of the repo')
      .action(async (key, value, options) => {
        await writeConfig(key, value, options)
      })

    const secretsCmd = configCmd.command('secrets').description('Manage deploy secrets')

    secretsCmd.command('list').action(listSecrets)
    secretsCmd
      .command('rotate <name>')
      .option('--force', 'Rotate even when the secret is in use')
      .action(rotateSecret)

    program
      .command('rollback')
      .description('Roll back the last deploy')
      .action(runRollback)

    program.parse(process.argv)
  `

  it('extracts the command tree in declaration order, nesting through variables', () => {
    // The leading '' is the PROGRAM itself (path []), the root command carrying
    // the program-level surface.
    expect(pathsOf(commanderCli(program))).toEqual([
      '',
      'deploy',
      'status',
      'config',
      'config get',
      'config set',
      'config secrets',
      'config secrets list',
      'config secrets rotate',
      'rollback',
    ])
  })

  it('emits the root command with the generated --version and --help, marked synthesized', () => {
    const root = commanderCli(program).find((c) => c.path.length === 0)
    expect(root?.name).toBe('')
    expect(root?.description).toBe('Deploy services from the command line')
    expect(root?.flags).toEqual([
      { flag: '--version', synthesized: true },
      { flag: '--help', synthesized: true },
    ])
  })

  it('keeps program-level options on the root command', () => {
    const commands = commanderCli(`
      import { Command } from 'commander'
      const program = new Command()
      program
        .option('--verbose', 'Print every step')
        .requiredOption('--config <path>', 'Path to the config file')
      program.command('run').action(runIt)
      program.parse()
    `)
    const root = commands.find((c) => c.path.length === 0)
    expect(root?.flags).toEqual([
      { flag: '--verbose', description: 'Print every step' },
      { flag: '--config', description: 'Path to the config file', takesValue: true, valueHint: 'path', required: true },
      { flag: '--help', synthesized: true },
    ])
  })

  it('emits a root for program-level flags alone, but not for a bare program', () => {
    const flagsOnly = commanderCli(`
      import { Command } from 'commander'
      const program = new Command()
      program.option('--debug', 'Verbose logging')
      program.parse()
    `)
    expect(pathsOf(flagsOnly)).toEqual([''])

    const bare = commanderCli(`
      import { Command } from 'commander'
      const program = new Command()
      program.description('Nothing registered').action(() => run())
      program.parse()
    `)
    expect(bare).toEqual([])
  })

  it('honors .helpOption(false) and a customized version flag', () => {
    const commands = commanderCli(`
      import { Command } from 'commander'
      const program = new Command()
      program.version('1.0.0', '-v, --vers', 'print the version').helpOption(false)
      program.command('run').action(runIt)
      program.parse()
    `)
    const root = commands.find((c) => c.path.length === 0)
    expect(root?.flags).toEqual([{ flag: '--vers', description: 'print the version', synthesized: true }])
  })

  it('keeps flags in declaration order, canonical long form, placeholders stripped', () => {
    const commands = commanderCli(program)
    expect(flagsOf(commands, 'deploy')).toEqual(['--env', '--dry-run', '--no-wait'])
    expect(flagsOf(commands, 'config set')).toEqual(['--global'])
    expect(flagsOf(commands, 'config secrets rotate')).toEqual(['--force'])
    expect(flagsOf(commands, 'config secrets list')).toEqual([])
  })

  it('carries descriptions and flag descriptions', () => {
    const deploy = commanderCli(program).find((c) => c.name === 'deploy')
    expect(deploy?.description).toBe('Deploy a service to an environment')
    expect(deploy?.flags[0]).toEqual({
      flag: '--env',
      description: 'Target environment',
      takesValue: true,
      valueHint: 'name',
    })
    // A switch declares no value, and says so by omission.
    expect(deploy?.flags[1]).toEqual({ flag: '--dry-run', description: 'Print the plan without applying it' })
  })

  it('names the handler for a direct reference and for a single-call arrow body', () => {
    const commands = commanderCli(program)
    expect(commands.find((c) => c.name === 'status')?.handlerName).toBe('runStatus')
    expect(commands.find((c) => c.name === 'deploy')?.handlerName).toBe('runDeploy')
  })

  it('leaves the handler unset when the action body calls several functions', () => {
    const commands = commanderCli(`
      import { Command } from 'commander'
      const program = new Command()
      program
        .command('analyze')
        .option('--diff', 'Diff against the last analysis')
        .action(async (options) => {
          const config = resolveConfig(options)
          if (options.diff) {
            await runAnalyzeDiff(config)
          } else {
            await runAnalyze(config)
          }
        })
    `)
    expect(commands[0].handlerName).toBeUndefined()
  })

  it('records the command name for the git-style executable form without nesting', () => {
    const commands = commanderCli(`
      import { Command } from 'commander'
      const program = new Command()
      program
        .command('install [name]', 'Install a plugin')
        .command('publish', 'Publish the current plugin')
      program.parse()
    `)
    expect(pathsOf(commands)).toEqual(['', 'install', 'publish'])
    expect(commands[1].description).toBe('Install a plugin')
  })

  it('resolves a command object used before its declaration', () => {
    const commands = commanderCli(`
      import { Command } from 'commander'
      registerMigrations()
      function registerMigrations() {
        dbCmd.command('migrate').option('--to <version>', 'Target revision').action(runMigrate)
      }
      const dbCmd = program.command('db').description('Database maintenance')
      const program = new Command()
    `)
    expect(pathsOf(commands)).toContain('db migrate')
    expect(flagsOf(commands, 'db migrate')).toEqual(['--to'])
  })

  /**
   * The OPTION GRAMMAR — what a caller needs to build an invocation, not just to
   * list flag names. Commander's `Option` is a fluent builder, so the real-world
   * declaration of a constrained flag is a CALL (`new Option(…).choices([…])`), and
   * reading only a bare `new Option(…)` dropped the whole option.
   */
  it('reads an Option through its builder chain, with the choices it declares', () => {
    const commands = commanderCli(`
      import { Command, Option } from 'commander'

      const program = new Command()
      const config = program.command('config').description('Read and write configuration')

      config
        .command('llm')
        .description('Configure the LLM transport')
        .addOption(
          new Option('--transport <mode>', 'Which transport to call the model through')
            .choices(['claude-code', 'api'])
            .default('claude-code'),
        )
        .addOption(new Option('--yes', 'Skip the confirmation prompt'))
        .requiredOption('-k, --api-key <key>', 'The provider API key')
        .option('--label [name]', 'Optional label for the profile')
        .action(runLlmSetup)

      program.parse(process.argv)
    `)

    const llm = commands.find((c) => c.path.join(' ') === 'config llm')
    expect(llm?.flags).toEqual([
      {
        flag: '--transport',
        description: 'Which transport to call the model through',
        takesValue: true,
        valueHint: 'mode',
        choices: ['claude-code', 'api'],
      },
      { flag: '--yes', description: 'Skip the confirmation prompt' },
      { flag: '--api-key', description: 'The provider API key', takesValue: true, valueHint: 'key', required: true },
      // `[name]` is an OPTIONAL value — the flag still takes one.
      { flag: '--label', description: 'Optional label for the profile', takesValue: true, valueHint: 'name' },
    ])
  })

  it('reads the CommonJS destructured require form', () => {
    const commands = extractCliCommands(
      parseCode(
        `
        const { Command } = require('commander')
        const program = new Command()
        program
          .command('serve')
          .option('-p, --port <n>', 'Port to listen on', parseInt)
          .action(function () { startServer() })
        program.parse(process.argv)
      `,
        'javascript',
      ),
      'bin/serve.js',
      'javascript',
    )
    expect(pathsOf(commands)).toEqual(['', 'serve'])
    expect(flagsOf(commands, 'serve')).toEqual(['--port'])
    expect(commands[1].handlerName).toBe('startServer')
  })

  it('reads the `program` singleton and the namespace import', () => {
    expect(
      pathsOf(
        commanderCli(`
          import { program } from 'commander'
          program.command('lint').option('--fix', 'Rewrite files in place').action(runLint)
        `),
      ),
    ).toEqual(['', 'lint'])

    expect(
      pathsOf(
        commanderCli(`
          import commander from 'commander'
          commander.program.command('lint').action(runLint)
        `),
      ),
    ).toEqual(['', 'lint'])
  })

  /**
   * The two registration idioms the self-verification gate first caught missing:
   * an option built by a module-scope FACTORY, and a choices list spreading a
   * module-scope const.
   */
  it('resolves an addOption factory to the Option chain its body returns', () => {
    const commands = commanderCli(`
      import { Command, Option } from 'commander'

      function transportOption(): Option {
        return new Option('--transport <mode>', 'How to reach the model').choices(['cli', 'api'])
      }
      const jsonOption = () => new Option('--json', 'Emit JSON')

      const program = new Command()
      program.command('analyze').addOption(transportOption()).addOption(jsonOption()).action(runAnalyze)
      program.parse()
    `)
    expect(flagsOf(commands, 'analyze')).toEqual(['--transport', '--json'])
    expect(commands.find((c) => c.name === 'analyze')?.flags[0]).toEqual({
      flag: '--transport',
      description: 'How to reach the model',
      takesValue: true,
      valueHint: 'mode',
      choices: ['cli', 'api'],
    })
  })

  it('resolves a module-scope const spread inside .choices()', () => {
    const commands = commanderCli(`
      import { Command, Option } from 'commander'

      const PROVIDERS = ['anthropic', 'openai'] as const

      const program = new Command()
      program
        .command('setup')
        .addOption(new Option('--provider <name>', 'API provider').choices([...PROVIDERS, 'bedrock']))
        .action(runSetup)
      program.parse()
    `)
    expect(commands.find((c) => c.name === 'setup')?.flags).toEqual([
      {
        flag: '--provider',
        description: 'API provider',
        takesValue: true,
        valueHint: 'name',
        choices: ['anthropic', 'openai', 'bedrock'],
      },
    ])
  })

  it('leaves an unresolvable spread (an imported const) without choices', () => {
    const commands = commanderCli(`
      import { Command, Option } from 'commander'
      import { KINDS } from './kinds.js'

      const program = new Command()
      program.command('setup').addOption(new Option('--kind <k>', 'Kind').choices([...KINDS]))
      program.parse()
    `)
    expect(commands.find((c) => c.name === 'setup')?.flags).toEqual([
      { flag: '--kind', description: 'Kind', takesValue: true, valueHint: 'k' },
    ])
  })

  it('records where a command is declared', () => {
    const status = commanderCli(program).find((c) => c.name === 'status')
    expect(status?.location.filePath).toBe('src/cli.ts')
    expect(status?.location.startLine).toBeGreaterThan(0)
  })
})

describe('extractCliCommands — yargs', () => {
  const program = `
    import yargs from 'yargs'
    import { hideBin } from 'yargs/helpers'
    import { addTask, listTasks, createProject, archiveProject, syncAll } from './tasks.js'

    yargs(hideBin(process.argv))
      .scriptName('todo')
      .command('add <title>', 'Add a task', (y) =>
        y
          .option('due', { describe: 'Due date (YYYY-MM-DD)', type: 'string' })
          .option('priority', { alias: 'p', describe: 'Priority', choices: ['low', 'high'] }),
        (argv) => addTask(argv))
      .command('list', 'List tasks',
        (y) => y.options({ done: { describe: 'Only completed tasks' }, json: { describe: 'JSON output' } }),
        listTasks)
      .command('project', 'Manage projects', (y) =>
        y
          .command('create <name>', 'Create a project', {}, createProject)
          .command('archive <name>', 'Archive a project', {}, archiveProject))
      .command({ command: 'sync', describe: 'Sync with the server', handler: syncAll })
      .demandCommand(1)
      .strict()
      .help()
      .parse()
  `

  it('keeps sibling commands flat and nests only through the builder callback', () => {
    expect(pathsOf(commanderCli(program))).toEqual([
      'add',
      'list',
      'project',
      'project create',
      'project archive',
      'sync',
    ])
  })

  it('normalizes bare option names to their long form', () => {
    const commands = commanderCli(program)
    expect(flagsOf(commands, 'add')).toEqual(['--due', '--priority'])
    expect(flagsOf(commands, 'list')).toEqual(['--done', '--json'])
  })

  it('reads a demanded option and its closed value set from the map form', () => {
    const commands = commanderCli(`
      import yargs from 'yargs'
      yargs
        .command('export', 'Export the dataset', (y) =>
          y.options({
            format: { describe: 'Output format', choices: ['json', 'csv'], demandOption: true },
            pretty: { describe: 'Indent the output', type: 'boolean' },
          }),
        )
        .parse()
    `)

    expect(commands.find((c) => c.name === 'export')?.flags).toEqual([
      { flag: '--format', description: 'Output format', choices: ['json', 'csv'], required: true },
      { flag: '--pretty', description: 'Indent the output' },
    ])
  })

  it('reads descriptions and handlers from both the positional and object forms', () => {
    const commands = commanderCli(program)
    expect(commands.find((c) => c.name === 'add')).toMatchObject({
      description: 'Add a task',
      handlerName: 'addTask',
    })
    expect(commands.find((c) => c.name === 'sync')).toMatchObject({
      description: 'Sync with the server',
      handlerName: 'syncAll',
    })
    expect(commands.find((c) => c.path.join(' ') === 'project create')?.handlerName).toBe(
      'createProject',
    )
  })

  it('takes the first alias of an array command and skips the default-command marker', () => {
    const commands = commanderCli(`
      import yargs from 'yargs'
      yargs
        .command(['get <key>', 'g'], 'Read a value', {}, getValue)
        .command('$0', 'Print usage', {}, printUsage)
        .parse()
    `)
    expect(pathsOf(commands)).toEqual(['get'])
  })
})

describe('extractCliCommands — scope', () => {
  it('extracts nothing from a file that imports neither framework', () => {
    const commands = commanderCli(`
      import { getQueue } from './queue.js'
      const queue = getQueue()
      queue.command('drain').option('--fast')
      queue.command('pause')
    `)
    expect(commands).toEqual([])
  })

  it('returns no commands for python and c# rather than failing', () => {
    const python = extractCliCommands(
      parseCode(
        [
          'import click',
          '',
          '@click.group()',
          'def cli():',
          '    pass',
          '',
          '@cli.command()',
          'def deploy():',
          '    pass',
        ].join('\n'),
        'python',
      ),
      'cli.py',
      'python',
    )
    expect(python).toEqual([])

    const csharp = extractCliCommands(
      parseCode(
        [
          'using System.CommandLine;',
          'class Program {',
          '  static int Main(string[] args) {',
          '    var root = new RootCommand("deploy");',
          '    return root.Invoke(args);',
          '  }',
          '}',
        ].join('\n'),
        'csharp',
      ),
      'Program.cs',
      'csharp',
    )
    expect(csharp).toEqual([])
  })
})

describe('FileAnalysis.cliCommands wiring', () => {
  it('carries the commands on the analysis, and is absent for a file with none', () => {
    const cli = analyzeFileContent(
      'src/cli.ts',
      `
      import { Command } from 'commander'
      const program = new Command()
      program.command('build').option('--watch', 'Rebuild on change').action(runBuild)
      program.parse()
    `,
      'typescript',
    )
    expect(cli.cliCommands).toEqual([
      // The program itself rides along: path [], with the generated --help.
      expect.objectContaining({ name: '', path: [], flags: [{ flag: '--help', synthesized: true }] }),
      expect.objectContaining({
        name: 'build',
        path: ['build'],
        flags: [{ flag: '--watch', description: 'Rebuild on change' }],
        handlerName: 'runBuild',
      }),
    ])

    const service = analyzeFileContent(
      'src/service.ts',
      `export function buildReport(rows: string[]): string { return rows.join('\\n') }`,
      'typescript',
    )
    expect(service.cliCommands).toBeUndefined()
  })
})
