/**
 * The probe fallback — the ladder a cli takes when no extractor reads its
 * framework. Every case here runs canned help transcripts through a fake exec: no
 * subprocess, no build. What is under test is the ladder's promise — a catalog
 * when the help is readable, exactly one root journey when it is not, a bounded
 * number of probes, and never an exception.
 */
import { describe, it, expect } from 'vitest'
import {
  deriveCliJourneysFromProbes,
  parseCliHelp,
  MAX_CLI_PROBES,
  type CliProbeCapture,
  type CliProbeExec,
} from '../../packages/journey-mapper/src/cli-probes'
import { deriveCliJourneysFromTree } from '../../packages/journey-mapper/src/cli-tree'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'

const ENTRY = ['/usr/local/bin/node', '/repo/dist/shipit.js']

const ROOT_HELP = `Usage: shipit [options] [command]

Deploy services from the command line

Options:
  -V, --version                output the version number
  -h, --help                   display help for command

Commands:
  deploy [options] <service>   Deploy a service to an environment, waiting for
                               the rollout to settle
  status [options]             Show the current rollout status
  config                       Inspect and change deploy configuration
  help [command]               display help for command
`

const DEPLOY_HELP = `Usage: shipit deploy [options] <service>

Deploy a service to an environment

Options:
  -e, --env <name>  Target environment (default: "staging")
  --dry-run         Print the plan without applying it
  -h, --help        display help for command
`

const CONFIG_HELP = `Usage: shipit config [options] [command]

Inspect and change deploy configuration

Options:
  -h, --help          display help for command

Commands:
  get <key>           Print one configuration value
  set <key> <value>   Change one configuration value
`

/** A fake exec over canned transcripts, keyed by the argv appended to the entry. */
function fakeExec(
  transcripts: Record<string, string>,
  calls: string[][] = [],
): CliProbeExec {
  return async (argv) => {
    expect(argv.slice(0, ENTRY.length)).toEqual(ENTRY)
    const args = [...argv].slice(ENTRY.length)
    calls.push(args)
    const stdout = transcripts[args.join(' ')] ?? ''
    return { stdout, stderr: '', exitCode: stdout ? 0 : 1 } satisfies CliProbeCapture
  }
}

describe('deriveCliJourneysFromProbes', () => {
  const transcripts = {
    '': ROOT_HELP,
    '--help': ROOT_HELP,
    'deploy --help': DEPLOY_HELP,
    'status --help': 'Usage: shipit status [options]\n\nOptions:\n  --json  Emit machine-readable JSON\n',
    'config --help': CONFIG_HELP,
    'help --help': 'Usage: shipit help [command]\n',
  }

  it('maps every listed command plus one level of their subcommands', async () => {
    const journeys = await deriveCliJourneysFromProbes({ entry: ENTRY, exec: fakeExec(transcripts) })
    expect(journeys.map((j) => j.id)).toEqual([
      'cli/config',
      'cli/config-get',
      'cli/config-set',
      'cli/deploy',
      'cli/help',
      'cli/status',
    ])
    expect(journeys.find((j) => j.id === 'cli/config-get')).toMatchObject({
      entry: { command: ['config', 'get'] },
      steps: [{ kind: 'invoke', command: ['config', 'get'], flags: [] }],
    })
  })

  it('reads each command flag set from its own --help', async () => {
    const journeys = await deriveCliJourneysFromProbes({ entry: ENTRY, exec: fakeExec(transcripts) })
    expect(journeys.find((j) => j.id === 'cli/deploy')?.steps[0]).toMatchObject({
      flags: ['--env', '--dry-run', '--help'],
    })
    expect(journeys.find((j) => j.id === 'cli/status')?.steps[0]).toMatchObject({ flags: ['--json'] })
  })

  it('carries each flag documented in --help as a schema-bearing option', async () => {
    const journeys = await deriveCliJourneysFromProbes({ entry: ENTRY, exec: fakeExec(transcripts) })
    expect(journeys.find((j) => j.id === 'cli/deploy')?.steps[0]).toMatchObject({
      options: [
        { flag: '--env', takesValue: true, valueHint: 'name' },
        { flag: '--dry-run', description: 'Print the plan without applying it' },
        { flag: '--help' },
      ],
    })
  })

  it('probes bare, --help, and one --help per listed command — nothing deeper', async () => {
    const calls: string[][] = []
    await deriveCliJourneysFromProbes({ entry: ENTRY, exec: fakeExec(transcripts, calls) })
    expect(calls).toEqual([
      [],
      ['--help'],
      ['deploy', '--help'],
      ['status', '--help'],
      ['config', '--help'],
      ['help', '--help'],
    ])
  })

  it('never spawns more than the probe cap, and still catalogs every listed command', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `task${String(i + 1).padStart(2, '0')}`)
    const help = `Usage: bulk [options] [command]\n\nCommands:\n${many
      .map((c) => `  ${c}   Run the ${c} job`)
      .join('\n')}\n`
    const calls: string[][] = []
    const journeys = await deriveCliJourneysFromProbes({
      entry: ENTRY,
      exec: fakeExec({ '': help, '--help': help }, calls),
    })
    expect(calls.length).toBe(MAX_CLI_PROBES)
    expect(journeys).toHaveLength(40)
    // The commands past the budget are still real surface — they just carry no
    // observed flags.
    expect(journeys.find((j) => j.id === 'cli/task40')?.steps[0]).toMatchObject({ flags: [] })
  })

  it('honors a smaller explicit budget', async () => {
    const calls: string[][] = []
    await deriveCliJourneysFromProbes({
      entry: ENTRY,
      exec: fakeExec(transcripts, calls),
      maxProbes: 3,
    })
    expect(calls).toEqual([[], ['--help'], ['deploy', '--help']])
  })
})

describe('deriveCliJourneysFromProbes — the degradation ladder', () => {
  it('yields exactly one root journey when the help lists no commands', async () => {
    const journeys = await deriveCliJourneysFromProbes({
      entry: ENTRY,
      exec: fakeExec({
        '': 'shipit 2.4.0\nRun `shipit --help` for usage.\n',
        '--help': 'shipit — deploys services. See https://example.com/docs for the manual.\n',
      }),
      programName: 'shipit',
    })
    expect(journeys).toHaveLength(1)
    expect(journeys[0]).toMatchObject({
      id: 'cli/root',
      type: 'cli',
      title: 'shipit',
      entry: { command: ['shipit'] },
      steps: [{ kind: 'invoke', command: ['shipit'], flags: [] }],
    })
  })

  it('yields the root journey — not an error — when every probe throws', async () => {
    const journeys = await deriveCliJourneysFromProbes({
      entry: ENTRY,
      exec: async () => {
        throw new Error('spawn ENOENT')
      },
      programName: 'shipit',
    })
    expect(journeys.map((j) => j.id)).toEqual(['cli/root'])
  })

  it('yields the root journey when the program only prints an error', async () => {
    const journeys = await deriveCliJourneysFromProbes({
      entry: ENTRY,
      exec: async () => ({ stdout: '', stderr: 'error: missing config file', exitCode: 1 }),
      programName: 'shipit',
    })
    expect(journeys.map((j) => j.id)).toEqual(['cli/root'])
  })

  it('names the root journey from the entry argv when no program name is given', async () => {
    const journeys = await deriveCliJourneysFromProbes({
      entry: ENTRY,
      exec: async () => ({ stdout: 'no help here', stderr: '', exitCode: 0 }),
    })
    expect(journeys[0].entry.command).toEqual(['shipit'])
  })
})

describe('parseCliHelp', () => {
  it('reads a commander command list without swallowing wrapped descriptions', () => {
    expect(parseCliHelp(ROOT_HELP).subcommands).toEqual(['deploy', 'status', 'config', 'help'])
  })

  it('reads a cobra-style "Available Commands" section', () => {
    const help = `A container platform

Usage:
  ctl [command]

Available Commands:
  apply       Apply a configuration to a resource
  describe    Show details of a resource
  logs        Print the logs for a container

Flags:
  -n, --namespace string   Namespace scope
`
    expect(parseCliHelp(help)).toEqual({
      subcommands: ['apply', 'describe', 'logs'],
      flags: ['--namespace'],
      options: [{ flag: '--namespace', description: 'Namespace scope' }],
    })
  })

  it('parses each option declaration into its schema — value hint, switch-ness, description', () => {
    expect(parseCliHelp(DEPLOY_HELP).options).toEqual([
      { flag: '--env', takesValue: true, valueHint: 'name', description: 'Target environment (default: "staging")' },
      { flag: '--dry-run', description: 'Print the plan without applying it' },
      { flag: '--help', description: 'display help for command' },
    ])
  })

  it('promotes a commander choices clause into the option schema', () => {
    const help = `Usage: tc setup [options]

Options:
  --transport <mode>  Transport to save (choices: "claude-code", "api")
  --model <id>        Model id every stage runs on
`
    expect(parseCliHelp(help).options).toEqual([
      {
        flag: '--transport',
        takesValue: true,
        valueHint: 'mode',
        choices: ['claude-code', 'api'],
        description: 'Transport to save',
      },
      { flag: '--model', takesValue: true, valueHint: 'id', description: 'Model id every stage runs on' },
    ])
  })

  it('reads an argparse metavar as the value hint', () => {
    const help = `usage: todo add [-h] [--due DATE]

options:
  --due DATE  Due date for the task
`
    expect(parseCliHelp(help).options).toEqual([
      { flag: '--due', takesValue: true, valueHint: 'DATE', description: 'Due date for the task' },
    ])
  })

  it('reads an argparse brace list', () => {
    const help = `usage: todo [-h] {add,list,done} ...

positional arguments:
  {add,list,done}
    add            Add a task
    list           List tasks
    done           Complete a task

options:
  -h, --help       show this help message and exit
`
    expect(parseCliHelp(help).subcommands).toEqual(['add', 'list', 'done'])
  })

  // Real commander output wraps long descriptions, and their `(choices: …)`
  // clauses, at the description column. Measured on TrueCourse's own
  // `config llm setup --help` before the joiner existed: `--transport` lost its
  // choices and kept a truncated description.
  it('joins wrapped option lines, so a split (choices: …) clause survives', () => {
    const help = `Usage: truecourse config llm setup [options]

Options:
  --transport <mode>   Transport to save (skips the prompts) (choices:
                       "claude-code", "api")
  --provider <name>    API provider (choices: "anthropic", "openai",
                       "bedrock", "copilot")
  --model <id>         Model id every stage runs on
`
    expect(parseCliHelp(help).options).toEqual([
      {
        flag: '--transport',
        takesValue: true,
        valueHint: 'mode',
        choices: ['claude-code', 'api'],
        description: 'Transport to save (skips the prompts)',
      },
      {
        flag: '--provider',
        takesValue: true,
        valueHint: 'name',
        choices: ['anthropic', 'openai', 'bedrock', 'copilot'],
        description: 'API provider',
      },
      { flag: '--model', takesValue: true, valueHint: 'id', description: 'Model id every stage runs on' },
    ])
  })

  it('joins a wrapped description without inventing options from its continuation', () => {
    const help = `Usage: truecourse analyze [options]

Options:
  --llm-transport <mode>  How to reach the LLM for this run: 'cli' (spawn claude
                          -p), 'agent' (filesystem mailbox), or 'api' (the
                          provider in config.json)
  --stash                 Pre-approve stashing pending changes before analysis
`
    const parsed = parseCliHelp(help)
    expect(parsed.flags).toEqual(['--llm-transport', '--stash'])
    expect(parsed.options[0]).toMatchObject({
      flag: '--llm-transport',
      takesValue: true,
      valueHint: 'mode',
      description:
        "How to reach the LLM for this run: 'cli' (spawn claude -p), 'agent' (filesystem mailbox), or 'api' (the provider in config.json)",
    })
  })

  it('a wrapped COMMAND description never joins onto an option line across a heading', () => {
    expect(parseCliHelp(ROOT_HELP).flags).toEqual(['--version', '--help'])
  })

  it('takes no commands from prose or usage examples', () => {
    const help = `Usage: shipit <service>

Deploy services. Run shipit deploy to ship the current branch, or read
the manual at https://example.com/docs for the full workflow.
`
    expect(parseCliHelp(help).subcommands).toEqual([])
  })
})

describe('probe and tree derivations agree', () => {
  it('fingerprints the same command surface identically whichever source found it', async () => {
    const fromTree = deriveCliJourneysFromTree([
      analyzeFileContent(
        'src/cli.ts',
        `
        import { Command } from 'commander'
        const program = new Command()
        program
          .command('deploy <service>')
          .description('Deploy a service to an environment')
          .option('-e, --env <name>', 'Target environment')
          .option('--dry-run', 'Print the plan without applying it')
          .option('-h, --help', 'display help for command')
          .action(runDeploy)
        program.parse()
      `,
        'typescript',
      ),
    ])
    const fromProbes = await deriveCliJourneysFromProbes({
      entry: ENTRY,
      exec: fakeExec({
        '': 'Usage: shipit [options] [command]\n\nCommands:\n  deploy [options] <service>  Deploy a service\n',
        '--help': 'Usage: shipit [options] [command]\n\nCommands:\n  deploy [options] <service>  Deploy a service\n',
        'deploy --help': DEPLOY_HELP,
      }),
    })

    const treeDeploy = fromTree.find((j) => j.id === 'cli/deploy')
    const probeDeploy = fromProbes.find((j) => j.id === 'cli/deploy')
    expect(probeDeploy?.fingerprint).toBe(treeDeploy?.fingerprint)
  })
})
