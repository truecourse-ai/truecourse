import { describe, expect, it } from 'vitest'
import { cliHelpContract, cliPositionals } from '../../packages/interface-mapper/src/cli-contracts'
import { buildCliInterfaces } from '../../packages/interface-mapper/src/cli-interfaces'
import { unionCliInterfaces } from '../../packages/interface-mapper/src/derive'
import { InterfaceContractSchema } from '../../packages/shared/src/interfaces'

describe('CLI help contracts', () => {
  it('reads aliases and value requirements only from the command being probed', () => {
    const help = `Usage: app write [options] <path> [content...]

Options:
  -m, --mode <name>  File mode
  --encoding [name]  Optional encoding
  --force           Overwrite existing files

Commands:
  child <id>        Inspect a child
`
    const contract = cliHelpContract(help, 'app', ['write'], ['write'])
    expect(contract).toEqual({
      path: ['app', 'write'],
      positionals: [{ name: 'path', required: true }, { name: 'content', required: false, variadic: true }],
      options: [
        { flag: '--mode', short: '-m', takesValue: true, valueRequired: true, valueHint: 'name', description: 'File mode' },
        { flag: '--encoding', takesValue: true, valueRequired: false, valueHint: 'name', description: 'Optional encoding' },
        { flag: '--force', takesValue: false, valueRequired: false, description: 'Overwrite existing files' },
      ],
    })
    expect(InterfaceContractSchema.safeParse({ surface: 'cli', command: contract }).success).toBe(true)
    expect(cliHelpContract(help, 'app', ['write', 'child'], ['write'])).toEqual({
      path: ['app', 'write', 'child'], description: 'Inspect a child', positionals: [{ name: 'id', required: true }],
    })
  })

  it('does not claim grammar from errors or turn flag values into positional arguments', () => {
    expect(cliHelpContract('Error: write requires <path>\n', 'app', ['write'], ['write'])).toBeUndefined()
    expect(cliPositionals('[options] [--mode <name>] --encoding <encoding> <path>')).toEqual([{ name: 'path', required: true }])
    expect(cliHelpContract('Usage: app write <path>\n', 'app', [])).toBeUndefined()
  })

  it('retains tree details and probe-only grammar through the union without changing identity', () => {
    const tree = buildCliInterfaces([{
      path: ['write'], flags: ['--force'], label: 'Write from source',
      contract: { path: ['write'], description: 'Write from source', positionals: [{ name: 'path', required: true }] },
    }])
    const probeContract = cliHelpContract('Usage: app write <path>\n\nOptions:\n  --force  Overwrite\n  --mode <name>  File mode\n  -h, --help  Help\n', 'app', ['write'], ['write'])!
    const probes = buildCliInterfaces([
      { path: ['write'], flags: ['--force', '--mode', '--help'], contract: probeContract },
      { path: ['read'], flags: [], contract: { path: ['app', 'read'], positionals: [{ name: 'path', required: true }] } },
    ])
    const merged = unionCliInterfaces(tree, probes).interfaces
    expect(merged.find((entry) => entry.id === 'cli/read')?.contract).toEqual(probes[1]?.contract)
    const write = merged.find((entry) => entry.id === 'cli/write')!
    expect(write.contract).toMatchObject({ command: {
      description: 'Write from source', positionals: [{ name: 'path', required: true }],
      options: [expect.objectContaining({ flag: '--force' }), expect.objectContaining({ flag: '--mode', valueHint: 'name' })],
    } })
    expect(write.fingerprint).toBe(buildCliInterfaces([{ path: ['write'], flags: ['--force', '--mode'] }])[0]?.fingerprint)
  })
})
