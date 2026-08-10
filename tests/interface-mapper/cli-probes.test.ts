/**
 * The probe fallback — the ladder a cli takes when no extractor reads its
 * framework. Every case here runs canned help transcripts through a fake exec: no
 * subprocess, no build. What is under test is the ladder's promise — a catalog
 * when the help is readable, exactly one root interface when it is not, a bounded
 * number of probes, and never an exception.
 */
import { describe, it, expect } from 'vitest'
import {
  deriveCliInterfacesFromProbes,
  parseCliHelp,
  MAX_CLI_PROBES,
  type CliProbeCapture,
  type CliProbeExec,
} from '../../packages/interface-mapper/src/cli-probes'
import { deriveCliInterfacesFromTree } from '../../packages/interface-mapper/src/cli-tree'
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

describe('deriveCliInterfacesFromProbes', () => {
  const transcripts = {
    '': ROOT_HELP,
    '--help': ROOT_HELP,
    'deploy --help': DEPLOY_HELP,
    'status --help': 'Usage: shipit status [options]\n\nOptions:\n  --json  Emit machine-readable JSON\n',
    'config --help': CONFIG_HELP,
    'help --help': 'Usage: shipit help [command]\n',
  }

  it('maps every listed command plus one level of their subcommands', async () => {
    const interfaces = await deriveCliInterfacesFromProbes({ entry: ENTRY, exec: fakeExec(transcripts) })
    expect(interfaces.map((j) => j.id)).toEqual([
      'cli/config',
      'cli/config-get',
      'cli/config-set',
      'cli/deploy',
      'cli/help',
      'cli/status',
    ])
    expect(interfaces.find((j) => j.id === 'cli/config-get')).toMatchObject({
      entry: { command: ['config', 'get'] },
      steps: [{ kind: 'invoke', command: ['config', 'get'], flags: [] }],
    })
  })

  it('reads each command flag set from its own --help', async () => {
    const interfaces = await deriveCliInterfacesFromProbes({ entry: ENTRY, exec: fakeExec(transcripts) })
    expect(interfaces.find((j) => j.id === 'cli/deploy')?.steps[0]).toMatchObject({
      flags: ['--env', '--dry-run', '--help'],
    })
    expect(interfaces.find((j) => j.id === 'cli/status')?.steps[0]).toMatchObject({ flags: ['--json'] })
  })

  it('probes bare, --help, and one --help per listed command — nothing deeper', async () => {
    const calls: string[][] = []
    await deriveCliInterfacesFromProbes({ entry: ENTRY, exec: fakeExec(transcripts, calls) })
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
    const interfaces = await deriveCliInterfacesFromProbes({
      entry: ENTRY,
      exec: fakeExec({ '': help, '--help': help }, calls),
    })
    expect(calls.length).toBe(MAX_CLI_PROBES)
    expect(interfaces).toHaveLength(40)
    // The commands past the budget are still real surface — they just carry no
    // observed flags.
    expect(interfaces.find((j) => j.id === 'cli/task40')?.steps[0]).toMatchObject({ flags: [] })
  })

  it('honors a smaller explicit budget', async () => {
    const calls: string[][] = []
    await deriveCliInterfacesFromProbes({
      entry: ENTRY,
      exec: fakeExec(transcripts, calls),
      maxProbes: 3,
    })
    expect(calls).toEqual([[], ['--help'], ['deploy', '--help']])
  })
})

describe('deriveCliInterfacesFromProbes — the degradation ladder', () => {
  it('yields exactly one root interface when the help lists no commands', async () => {
    const interfaces = await deriveCliInterfacesFromProbes({
      entry: ENTRY,
      exec: fakeExec({
        '': 'shipit 2.4.0\nRun `shipit --help` for usage.\n',
        '--help': 'shipit — deploys services. See https://example.com/docs for the manual.\n',
      }),
      programName: 'shipit',
    })
    expect(interfaces).toHaveLength(1)
    expect(interfaces[0]).toMatchObject({
      id: 'cli/root',
      type: 'cli',
      title: 'shipit',
      entry: { command: ['shipit'] },
      steps: [{ kind: 'invoke', command: ['shipit'], flags: [] }],
    })
  })

  it('yields the root interface — not an error — when every probe throws', async () => {
    const interfaces = await deriveCliInterfacesFromProbes({
      entry: ENTRY,
      exec: async () => {
        throw new Error('spawn ENOENT')
      },
      programName: 'shipit',
    })
    expect(interfaces.map((j) => j.id)).toEqual(['cli/root'])
  })

  it('yields the root interface when the program only prints an error', async () => {
    const interfaces = await deriveCliInterfacesFromProbes({
      entry: ENTRY,
      exec: async () => ({ stdout: '', stderr: 'error: missing config file', exitCode: 1 }),
      programName: 'shipit',
    })
    expect(interfaces.map((j) => j.id)).toEqual(['cli/root'])
  })

  it('names the root interface from the entry argv when no program name is given', async () => {
    const interfaces = await deriveCliInterfacesFromProbes({
      entry: ENTRY,
      exec: async () => ({ stdout: 'no help here', stderr: '', exitCode: 0 }),
    })
    expect(interfaces[0].entry.command).toEqual(['shipit'])
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
    })
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
    const fromTree = deriveCliInterfacesFromTree([
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
    const fromProbes = await deriveCliInterfacesFromProbes({
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
